// Gate + LLM proxy worker (shared pattern across the Ave apps).
// Serves the app only to browsers that unlocked with a valid serial
// (validated against the serial-activation license service, which enforces
// the per-product device limit). /api/chat requires a valid session and
// enforces the model + token cap server-side so the API key can't be abused.
//
// Bindings (wrangler.toml): ASSETS, LICENSE, LICENSE_API, PRODUCT_CODE.
// Secret: SESSION_SECRET — set with `wrangler secret put SESSION_SECRET`.

const MODEL = 'claude-haiku-4-5-20251001';
const MAX_TOKENS = 1500;
const MAX_BODY_BYTES = 50000;

const COOKIE = 'ave_s';
// Lifetime licenses: long sessions; the unlock page silently re-validates
// with the stored serial when a session expires, so a refunded/deactivated
// serial loses access at the next renewal.
const SESSION_DAYS = 90;

// Files the unlock page itself needs — everything else requires a session.
const PUBLIC_FILES = new Set(['/unlock', '/unlock.html', '/unlock.js', '/manifest.json', '/favicon.ico']);
const PUBLIC_DIRS = ['/icons/', '/css/'];

const enc = new TextEncoder();
const toHex = buf => Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');

async function hmacHex(value, secret) {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return toHex(await crypto.subtle.sign('HMAC', key, enc.encode(value)));
}

async function makeSession(secret) {
  const payload = btoa(JSON.stringify({ exp: Date.now() + SESSION_DAYS * 86400000 }));
  return `${payload}.${await hmacHex(payload, secret)}`;
}

async function hasValidSession(request, secret) {
  const m = (request.headers.get('Cookie') || '').match(new RegExp(`(?:^|;\\s*)${COOKIE}=([^;]+)`));
  if (!m) return false;
  const dot = m[1].lastIndexOf('.');
  if (dot < 1) return false;
  const payload = m[1].slice(0, dot), sig = m[1].slice(dot + 1);
  if (await hmacHex(payload, secret) !== sig) return false;
  try { return JSON.parse(atob(payload)).exp > Date.now(); } catch { return false; }
}

function json(data, status = 200, extra = {}) {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json', ...extra } });
}

async function handleUnlock(request, env) {
  let body;
  try { body = await request.json(); } catch { return json({ error: 'Invalid request' }, 400); }
  const serial = String(body?.serial || '').trim().toUpperCase();
  const machineId = String(body?.machineId || '').trim();
  if (!/^[A-Z0-9-]{10,64}$/.test(serial)) return json({ error: 'That does not look like a serial number' }, 400);
  if (!machineId || machineId.length > 100) return json({ error: 'Missing device id' }, 400);

  let res, data;
  try {
    // Service binding when deployed (same-account worker-to-worker fetch is
    // blocked on workers.dev); plain fetch as fallback for local dev.
    const doFetch = env.LICENSE ? env.LICENSE.fetch.bind(env.LICENSE) : fetch;
    res = await doFetch(`${env.LICENSE_API}/activate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ serial, machineId }),
    });
    data = await res.json();
  } catch {
    return json({ error: 'The license service could not be reached. Try again shortly.' }, 502);
  }
  if (!res.ok) return json({ error: data?.error || 'Activation failed' }, res.status);
  if (env.PRODUCT_CODE && data.product !== env.PRODUCT_CODE) {
    return json({ error: 'That serial belongs to a different product' }, 403);
  }

  const session = await makeSession(env.SESSION_SECRET);
  return json({ ok: true }, 200, {
    'Set-Cookie': `${COOKIE}=${session}; Path=/; Max-Age=${SESSION_DAYS * 86400}; HttpOnly; Secure; SameSite=Lax`,
  });
}

async function handleChat(request, env) {
  const raw = await request.text();
  if (raw.length > MAX_BODY_BYTES) {
    return json({ error: { message: 'Request too large' } }, 413);
  }
  let body;
  try {
    body = JSON.parse(raw);
  } catch (e) {
    return json({ error: { message: 'Invalid JSON' } }, 400);
  }

  // Model and spend cap are enforced here; client-sent values are ignored/clamped
  body.model = MODEL;
  body.max_tokens = Math.min(Number(body.max_tokens) || MAX_TOKENS, MAX_TOKENS);
  body.stream = false;

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify(body)
  });
  const data = await response.json();
  return json(data, response.status);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;

    if (path === '/api/unlock') {
      if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
      return handleUnlock(request, env);
    }

    if (path === '/api/chat' && request.method === 'POST') {
      if (!(await hasValidSession(request, env.SESSION_SECRET))) {
        return json({ error: { message: 'Locked' } }, 403);
      }
      return handleChat(request, env);
    }

    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return json({ error: 'Method not allowed' }, 405);
    }

    const isPublic = PUBLIC_FILES.has(path) || PUBLIC_DIRS.some(d => path.startsWith(d));
    if (!isPublic && !(await hasValidSession(request, env.SESSION_SECRET))) {
      const wantsPage = (request.headers.get('Accept') || '').includes('text/html');
      if (wantsPage) return Response.redirect(new URL('/unlock', url).toString(), 302);
      return json({ error: 'Locked' }, 403);
    }
    return env.ASSETS.fetch(request);
  }
};
