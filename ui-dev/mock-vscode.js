// Mock implementation of VS Code Webview API for browser preview
(function() {
  let state = {};

  async function handlePostMessage(msg) {
    console.log('[VS Code API Bridge] Outgoing message:', msg);
    try {
      const res = await fetch('/api/vscode-message', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(msg)
      });
      const data = await res.json();
      if (data && data.events && Array.isArray(data.events)) {
        data.events.forEach(evt => {
          window.dispatchEvent(new MessageEvent('message', { data: evt }));
        });
      }
    } catch (err) {
      console.warn('[VS Code API Bridge] Error posting message:', err);
    }
  }

  window.acquireVsCodeApi = function() {
    return {
      postMessage: function(msg) {
        handlePostMessage(msg);
      },
      getState: function() {
        return state;
      },
      setState: function(newState) {
        state = newState;
        return state;
      }
    };
  };

  window._vscodeApi = window.acquireVsCodeApi();

  // Listen for streaming events from server
  const eventSource = new EventSource('/api/stream-events');
  eventSource.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);
      window.dispatchEvent(new MessageEvent('message', { data }));
    } catch (e) {
      // ignore
    }
  };
})();
