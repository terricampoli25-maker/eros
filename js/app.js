const SYSTEM_PROMPT = `You are Ave, a warm and romantic poetry oracle. When the user types anything — a feeling, a situation, a single word — respond with the single most relevant love poem quote possible. The quote can come from any poet, any era, any tradition. Return your response as JSON in this exact format with no preamble or markdown:
{"quote": "the quote here", "source": "Poet name, poem title if known"}`;

const speechBubble = document.getElementById('speechBubble');
const bubbleText = document.getElementById('bubbleText');
const bubbleClose = document.getElementById('bubbleClose');
const userInput = document.getElementById('userInput');
const sendBtn = document.getElementById('sendBtn');

const OPENING = "Love speaks thus...";

let currentSource = null;

function showBubble(text) {
  bubbleText.textContent = text;
  speechBubble.classList.remove('hidden');
}

function hideBubble() {
  speechBubble.classList.add('hidden');
}

function resetApp() {
  bubbleText.textContent = OPENING;
  speechBubble.classList.remove('hidden');
  userInput.value = '';
  currentSource = null;
}

userInput.addEventListener('input', () => {
  userInput.style.height = 'auto';
  userInput.style.height = userInput.scrollHeight + 'px';
  if (userInput.value.trim().length > 0) {
    hideBubble();
  } else {
    speechBubble.classList.remove('hidden');
  }
});

bubbleClose.addEventListener('click', resetApp);

function showTyping() {
  bubbleText.innerHTML = '';
  const t = document.createElement('div');
  t.className = 'typing';
  t.innerHTML = '<div class="dot"></div><div class="dot"></div><div class="dot"></div>';
  bubbleText.appendChild(t);
  speechBubble.classList.remove('hidden');
}

function displayQuoteWithButton(quote, source) {
  bubbleText.innerHTML = '';
  
  const quoteP = document.createElement('p');
  quoteP.className = 'quote-text';
  quoteP.textContent = quote;
  bubbleText.appendChild(quoteP);
  
  const button = document.createElement('button');
  button.className = 'reveal-source-btn';
  button.textContent = 'The poet...';
  
  const sourceP = document.createElement('p');
  sourceP.className = 'source-text hidden';
  sourceP.textContent = source;
  
  button.addEventListener('click', () => {
    sourceP.classList.toggle('hidden');
  });
  
  bubbleText.appendChild(button);
  bubbleText.appendChild(sourceP);
  
  currentSource = source;
}

async function sendMessage() {
  const text = userInput.value.trim();
  if (!text) return;

  userInput.value = '';
  userInput.style.height = 'auto';
  sendBtn.disabled = true;
  showTyping();

  try {
    const response = await fetch('/api/chat', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 1500,
        system: SYSTEM_PROMPT,
        messages: [
          { role: 'user', content: text }
        ]
      })
    });

    if (response.status === 403) {
      location.href = '/unlock';
      return;
    }

    if (!response.ok) {
      const err = await response.json();
      throw new Error(err.error?.message || response.statusText);
    }

    const data = await response.json();
    const reply = data.content.map(b => b.text || '').join('');

    // Parse JSON response - strip markdown code blocks and whitespace
    let jsonStr = reply.trim();
    // Remove markdown code block if present
    jsonStr = jsonStr.replace(/^```json\s*/, '').replace(/\s*```$/, '');
    jsonStr = jsonStr.replace(/^```\s*/, '').replace(/\s*```$/, '');
    jsonStr = jsonStr.trim();
    
    let quoteData = { quote: reply, source: 'Unknown' };
    try {
      quoteData = JSON.parse(jsonStr);
    } catch (e) {
      // If not valid JSON, display as is
      quoteData = { quote: reply, source: 'Unknown' };
    }

    displayQuoteWithButton(quoteData.quote, quoteData.source);

  } catch (err) {
    showBubble(`Something went wrong: ${err.message}`);
  }

  sendBtn.disabled = false;
  userInput.focus();
}

sendBtn.addEventListener('click', sendMessage);

userInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendMessage();
  }
});