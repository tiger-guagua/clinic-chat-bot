(function () {
  'use strict';

  const transcript = document.getElementById('transcript');
  const errorBox = document.getElementById('error');
  const chatForm = document.getElementById('chat-form');
  const messageInput = document.getElementById('message-input');
  const sendButton = document.getElementById('send-button');
  const talkButton = document.getElementById('talk-button');

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

  function addSpeakButton(bubble) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'speak-button';
    button.textContent = '\u{1F50A}';
    button.title = 'Play this reply aloud';
    button.addEventListener('click', function () {
      button.disabled = true;
      fetch('/api/speech', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // TTS input is capped server-side at 500 characters.
        body: JSON.stringify({ text: bubble.textContent.slice(0, 500) }),
      })
        .then(function (response) {
          if (!response.ok) {
            throw new Error('Speech playback is unavailable.');
          }
          return response.blob();
        })
        .then(function (blob) {
          const audio = new Audio(URL.createObjectURL(blob));
          audio.addEventListener('ended', function () {
            button.disabled = false;
          });
          return audio.play();
        })
        .catch(function (error) {
          button.disabled = false;
          showError(error.message);
        });
    });
    bubble.appendChild(button);
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

  function sendUserMessage(text) {
    if (sending || text.length === 0) {
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
        addSpeakButton(pending);
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
  }

  chatForm.addEventListener('submit', function (event) {
    event.preventDefault();
    sendUserMessage(messageInput.value.trim());
  });

  // --- Push-to-talk: hold to record, release to transcribe and send. ---

  let mediaRecorder = null;
  let audioChunks = [];
  let recording = false;

  function setTalkState(label, active) {
    talkButton.textContent = label;
    talkButton.classList.toggle('recording', active);
  }

  async function startRecording() {
    if (recording || sending) {
      return;
    }
    clearError();
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      audioChunks = [];
      mediaRecorder = new MediaRecorder(stream);
      mediaRecorder.addEventListener('dataavailable', function (event) {
        if (event.data.size > 0) {
          audioChunks.push(event.data);
        }
      });
      mediaRecorder.addEventListener('stop', function () {
        stream.getTracks().forEach(function (track) {
          track.stop();
        });
        transcribeAndSend();
      });
      mediaRecorder.start();
      recording = true;
      setTalkState('Recording... release to send', true);
    } catch (error) {
      showError('Microphone access failed: ' + error.message);
    }
  }

  function stopRecording() {
    if (!recording || !mediaRecorder) {
      return;
    }
    recording = false;
    setTalkState('Transcribing...', false);
    mediaRecorder.stop();
  }

  function transcribeAndSend() {
    const blob = new Blob(audioChunks, {
      type: mediaRecorder.mimeType || 'audio/webm',
    });
    audioChunks = [];
    if (blob.size === 0) {
      setTalkState('Hold to talk', false);
      return;
    }

    const formData = new FormData();
    formData.append('audio', blob, 'recording.webm');

    fetch('/api/transcribe', { method: 'POST', body: formData })
      .then(function (response) {
        return response.json().then(function (body) {
          if (!response.ok) {
            throw new Error(body && body.message ? body.message : 'Transcription failed.');
          }
          return body.text;
        });
      })
      .then(function (text) {
        const trimmed = (text || '').trim();
        if (trimmed.length === 0) {
          showError('No speech detected. Please try again.');
          return;
        }
        sendUserMessage(trimmed);
      })
      .catch(function (error) {
        showError(error.message);
      })
      .finally(function () {
        setTalkState('Hold to talk', false);
      });
  }

  if (navigator.mediaDevices && window.MediaRecorder) {
    talkButton.disabled = false;
    talkButton.title = 'Hold to record a voice message';
    talkButton.addEventListener('mousedown', startRecording);
    talkButton.addEventListener('mouseup', stopRecording);
    talkButton.addEventListener('mouseleave', stopRecording);
    talkButton.addEventListener('touchstart', function (event) {
      event.preventDefault();
      startRecording();
    });
    talkButton.addEventListener('touchend', function (event) {
      event.preventDefault();
      stopRecording();
    });
  } else {
    talkButton.title = 'Voice input is not supported in this browser';
  }
})();
