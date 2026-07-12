// Unlock page — sends serial + a random per-browser device id to the gate
// worker, which validates it against the license service. On success the
// serial is remembered locally so session renewal happens silently; a
// deactivated serial lands back on the form.

const DEVICE_KEY = 'ave_device_v1';
const SERIAL_KEY = 'ave_serial_v1';

let deviceId;
try {
  deviceId = localStorage.getItem(DEVICE_KEY);
  if (!deviceId) {
    deviceId = crypto.randomUUID();
    localStorage.setItem(DEVICE_KEY, deviceId);
  }
} catch (_) {
  deviceId = crypto.randomUUID();
}

const form  = document.getElementById('unlock-form');
const input = document.getElementById('unlock-serial');
const btn   = document.getElementById('unlock-btn');
const errEl = document.getElementById('unlock-error');
const lead  = document.getElementById('unlock-lead');

async function attemptUnlock(serial) {
  const res = await fetch('api/unlock', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ serial, machineId: deviceId }),
  });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok && data.ok, status: res.status, error: data.error };
}

form.addEventListener('submit', async e => {
  e.preventDefault();
  const serial = input.value.trim().toUpperCase();
  if (!serial) { errEl.textContent = 'Enter the serial from your purchase email.'; return; }

  btn.disabled = true;
  btn.textContent = 'Unlocking…';
  errEl.textContent = '';

  try {
    const r = await attemptUnlock(serial);
    if (r.ok) {
      try { localStorage.setItem(SERIAL_KEY, serial); } catch (_) {}
      location.replace('./');
      return;
    }
    errEl.textContent = r.error || 'That serial could not be verified.';
  } catch (_) {
    errEl.textContent = 'The license service could not be reached. Check your connection.';
  }
  btn.disabled = false;
  btn.textContent = 'Unlock';
});

// Silent renewal — if a serial is remembered from a previous unlock on this
// device, try it immediately. Runs once per page load; no loops.
(async () => {
  let saved = null;
  try { saved = localStorage.getItem(SERIAL_KEY); } catch (_) {}
  if (!saved) return;

  lead.textContent = 'Checking your license…';
  btn.disabled = true;
  try {
    const r = await attemptUnlock(saved);
    if (r.ok) { location.replace('./'); return; }
    // Serial revoked or unknown — forget it so the form starts clean.
    if (r.status === 403 || r.status === 404) {
      try { localStorage.removeItem(SERIAL_KEY); } catch (_) {}
    }
    errEl.textContent = r.error || 'Your serial could no longer be verified.';
  } catch (_) {
    errEl.textContent = 'The license service could not be reached. Check your connection.';
  }
  lead.textContent = 'Enter the serial number from your purchase email.';
  btn.disabled = false;
})();
