(function () {
  'use strict';

  const transcript = document.getElementById('transcript');
  const errorBox = document.getElementById('error');
  const chatForm = document.getElementById('chat-form');
  const messageInput = document.getElementById('message-input');

  function addMessage(role, text) {
    const bubble = document.createElement('div');
    bubble.className = 'message ' + role;
    bubble.textContent = text;
    transcript.appendChild(bubble);
    transcript.scrollTop = transcript.scrollHeight;
  }

  function showError(text) {
    errorBox.textContent = text;
    errorBox.hidden = false;
  }

  function clearError() {
    errorBox.textContent = '';
    errorBox.hidden = true;
  }

  addMessage(
    'assistant',
    'Hello! I can help you find and book a dental appointment.'
  );

  chatForm.addEventListener('submit', function (event) {
    event.preventDefault();
    clearError();

    const text = messageInput.value.trim();
    if (text.length === 0) {
      return;
    }

    addMessage('user', text);
    messageInput.value = '';

    // The /api/chat backend arrives in a later phase.
    showError('Chat is not connected yet. The booking backend is under construction.');
  });
})();
