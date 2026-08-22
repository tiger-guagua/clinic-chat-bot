(function () {
  'use strict';

  const transcript = document.getElementById('transcript');
  const errorBox = document.getElementById('error');
  const chatForm = document.getElementById('chat-form');
  const messageInput = document.getElementById('message-input');
  const sendButton = document.getElementById('send-button');

  // The browser owns the conversation history and sends it with every request.
  const messages = [];
  let sending = false;

  function addMessage(role, text) {
    const bubble = document.createElement('div');
    bubble.className = 'message ' + role;
    bubble.textContent = text;
    transcript.appendChild(bubble);
    transcript.scrollTop = transcript.scrollHeight;
    return bubble;
  }

  function showError(text) {
    errorBox.textContent = text;
    errorBox.hidden = false;
  }

  function clearError() {
    errorBox.textContent = '';
    errorBox.hidden = true;
  }

  function setSending(value) {
    sending = value;
    sendButton.disabled = value;
    messageInput.disabled = value;
  }

  async function sendChat() {
    const response = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: messages }),
    });

    const body = await response.json().catch(function () {
      return null;
    });

    if (!response.ok) {
      const message =
        body && body.message ? body.message : 'The request failed. Please try again.';
      throw new Error(message);
    }
    if (!body || !body.message || typeof body.message.content !== 'string') {
      throw new Error('Unexpected response from the server.');
    }
    return body.message.content;
  }

  addMessage(
    'assistant',
    'Hello! I can help you find and book a dental appointment. ' +
      'Ask me about our services or availability.'
  );

  chatForm.addEventListener('submit', function (event) {
    event.preventDefault();
    if (sending) {
      return;
    }

    const text = messageInput.value.trim();
    if (text.length === 0) {
      return;
    }

    clearError();
    addMessage('user', text);
    messages.push({ role: 'user', content: text });
    messageInput.value = '';
    setSending(true);

    const pending = addMessage('assistant', '...');

    sendChat()
      .then(function (reply) {
        pending.textContent = reply;
        messages.push({ role: 'assistant', content: reply });
      })
      .catch(function (error) {
        pending.remove();
        messages.pop();
        showError(error.message);
        messageInput.value = text;
      })
      .finally(function () {
        setSending(false);
        messageInput.focus();
      });
  });
})();
