const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const rootDir = path.join(__dirname, '..');
const uiDevDir = path.join(rootDir, 'ui-dev');

console.log('--- Rebuilding localhost:8888 from extension source ---');

// 1. Read git HEAD workflowWebview.ts to get the 100% clean, complete original
const originalSource = execSync('git show HEAD:src/ui/workflowWebview.ts', { maxBuffer: 20 * 1024 * 1024 }).toString('utf8');

// Extract complete <style>
const styleStart = originalSource.indexOf('<style>') + '<style>'.length;
const styleEnd = originalSource.indexOf('</style>', styleStart);
let fullCss = originalSource.slice(styleStart, styleEnd).trim();

console.log(`Extracted full CSS: ${fullCss.length} bytes`);

// Extract complete body
const bodyTagStart = originalSource.indexOf('<body>', styleEnd) + '<body>'.length;
const scriptTagStart = originalSource.indexOf('<script nonce="${nonce}">', bodyTagStart);
let fullBody = originalSource.slice(bodyTagStart, scriptTagStart).trim();

console.log(`Extracted full Body: ${fullBody.length} bytes`);

// Extract complete script
const scriptTagEnd = originalSource.lastIndexOf('</script>');
let fullJs = originalSource.slice(scriptTagStart + '<script nonce="${nonce}">'.length, scriptTagEnd).trim();

console.log(`Extracted full JS: ${fullJs.length} bytes`);

// ---------------------------------------------------------------------
// 2. APPLY USER-REQUESTED REFINEMENTS TO CSS
// ---------------------------------------------------------------------

// Ensure body and html fill 100vh with no outer scroll for fixed viewport chat
fullCss = fullCss.replace(
  /\* \{\s*box-sizing:\s*border-box;\s*margin:\s*0;\s*padding:\s*0;\s*\}\s*body \{[\s\S]*?overflow-x:\s*hidden;\s*\}/,
  `* { box-sizing: border-box; margin: 0; padding: 0; }
    html, body {
      height: 100%;
      margin: 0;
      padding: 0;
    }
    body {
      background: var(--bg);
      color: var(--fg);
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
      font-size: 13px;
      line-height: 1.5;
      padding: 12px 18px 10px 18px;
      overflow: hidden;
      display: flex;
      flex-direction: column;
      box-sizing: border-box;
      height: 100vh;
    }`
);

// Header and quick actions flex sizing
fullCss = fullCss.replace(
  /\.header \{[\s\S]*?gap:\s*12px;\s*\}/,
  `.header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding-bottom: 10px;
      border-bottom: 1px solid var(--border);
      margin-bottom: 8px;
      flex-wrap: wrap;
      gap: 10px;
      flex-shrink: 0;
    }`
);

fullCss = fullCss.replace(
  /\.quick-actions-section \{[\s\S]*?backdrop-filter:\s*blur\(8px\);\s*\}/,
  `.quick-actions-section {
      background: rgba(15, 23, 42, 0.6);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 6px 12px;
      margin-bottom: 8px;
      backdrop-filter: blur(8px);
      flex-shrink: 0;
    }`
);

// Tab content layout (scrolls internally, flex-1)
fullCss = fullCss.replace(
  /\.tab-content \{\s*display:\s*none;\s*\}/,
  `.tab-content {
      display: none;
      flex: 1;
      min-height: 0;
      overflow-y: auto;
    }
    #chatTab {
      overflow: hidden !important;
      flex-direction: column;
    }`
);

// Chat console wrapper
fullCss = fullCss.replace(
  /\.chat-console-wrapper \{[\s\S]*?min-height:\s*520px;\s*\}/,
  `.chat-console-wrapper {
      display: flex;
      flex-direction: column;
      flex: 1;
      min-height: 0;
      height: 100%;
    }`
);

// Chat header section
fullCss = fullCss.replace(
  /\.chat-header-section \{[\s\S]*?overflow:\s*hidden;\s*\}/,
  `.chat-header-section {
      background: rgba(15, 23, 42, 0.75);
      border: 1px solid var(--border);
      border-radius: 10px;
      margin-bottom: 6px;
      backdrop-filter: blur(8px);
      overflow: hidden;
      flex-shrink: 0;
    }`
);

// Chat input bar pinned at bottom
fullCss = fullCss.replace(
  /\.chat-input-bar \{[\s\S]*?backdrop-filter:\s*blur\(12px\);\s*\}/,
  `.chat-input-bar {
      background: rgba(15, 23, 42, 0.95);
      border: 1px solid var(--border);
      border-radius: 10px;
      padding: 7px 10px;
      margin-top: 6px;
      box-shadow: 0 -4px 20px rgba(0, 0, 0, 0.35);
      backdrop-filter: blur(12px);
      flex-shrink: 0;
      position: sticky;
      bottom: 0;
      z-index: 20;
    }`
);

// Distinct voice bubble styles
if (!fullCss.includes('voice-user-bubble')) {
  fullCss = fullCss.replace(
    /\.chat-bubble\.ai-bubble \{[\s\S]*?box-shadow:\s*0 4px 16px rgba\(0,\s*0,\s*0,\s*0\.35\);\s*\}/,
    `.chat-bubble.ai-bubble {
      background: rgba(30, 41, 59, 0.85);
      border: 1px solid rgba(56, 189, 248, 0.25);
      color: #f1f5f9;
      border-bottom-left-radius: 3px;
      box-shadow: 0 4px 16px rgba(0, 0, 0, 0.35);
    }

    /* Distinct Voice Mode Transcript Bubbles */
    .chat-bubble.voice-user-bubble {
      background: linear-gradient(135deg, #0284c7 0%, #2563eb 100%) !important;
      color: #ffffff !important;
      border: 1px solid rgba(56, 189, 248, 0.45);
      box-shadow: 0 4px 16px rgba(2, 132, 199, 0.35);
    }

    .chat-bubble.voice-ai-bubble {
      background: rgba(30, 41, 59, 0.92) !important;
      border: 1px solid rgba(148, 163, 184, 0.25) !important;
      color: #f1f5f9 !important;
      box-shadow: 0 4px 16px rgba(0, 0, 0, 0.35);
    }`
  );
}

// Add dev server banner styles
const devBannerCss = `
/* Dev Server Banner */
.ui-dev-banner {
  display: flex;
  justify-content: space-between;
  align-items: center;
  background: linear-gradient(90deg, rgba(37, 99, 235, 0.25) 0%, rgba(139, 92, 246, 0.25) 100%);
  border: 1px solid rgba(59, 130, 246, 0.4);
  border-radius: 8px;
  padding: 8px 14px;
  margin-bottom: 10px;
  font-size: 12px;
  color: #e2e8f0;
  backdrop-filter: blur(8px);
  flex-shrink: 0;
}
.ui-dev-left {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
}
.ui-dev-badge {
  font-weight: 700;
  color: #60a5fa;
}
.ui-dev-tag {
  background: rgba(255, 255, 255, 0.08);
  padding: 2px 8px;
  border-radius: 4px;
  border: 1px solid rgba(255, 255, 255, 0.1);
}
.ui-dev-live {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: #10b981;
  font-weight: 500;
}
.ui-dev-live-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: #10b981;
  box-shadow: 0 0 8px #10b981;
  animation: devPulse 2s infinite;
}
@keyframes devPulse {
  0%, 100% { opacity: 1; transform: scale(1); }
  50% { opacity: 0.5; transform: scale(0.85); }
}
.ui-dev-right {
  display: flex;
  align-items: center;
  gap: 8px;
}
`;

// Save style.css
fs.writeFileSync(path.join(uiDevDir, 'style.css'), fullCss + '\n' + devBannerCss, 'utf8');
console.log('Saved ui-dev/style.css');

// ---------------------------------------------------------------------
// 3. APPLY USER-REQUESTED REFINEMENTS TO BODY
// ---------------------------------------------------------------------

// Remove redundant tabs-bar
fullBody = fullBody.replace(
  /\r?\n\s*<!-- Navigation Tabs -->\s*<div class="tabs-bar">[\s\S]*?<\/div>/,
  ''
);

// Collapse #qaGrid by default so the chat is immediate
fullBody = fullBody.replace(
  /<div class="qa-grid" id="qaGrid"[^>]*>/,
  '<div class="qa-grid" id="qaGrid" style="display: none;">'
);
fullBody = fullBody.replace(
  /<button class="btn btn-secondary" data-action="toggleQuickHub"[^>]*>.*?<\/button>/,
  '<button class="btn btn-secondary" data-action="toggleQuickHub" onclick="toggleQuickHub()" id="qaToggleBtn" style="font-size: 11px; padding: 3px 9px;">Show Hub</button>'
);

// Make #chatTab visible by default on localhost
fullBody = fullBody.replace(
  /<div id="workflowTab" class="tab-content"[^>]*>/,
  '<div id="workflowTab" class="tab-content" style="display: none;">'
);
fullBody = fullBody.replace(
  /<div id="chatTab" class="tab-content"[^>]*>/,
  '<div id="chatTab" class="tab-content" style="display: block;">'
);

// Replace template literals with static dev values
fullBody = fullBody.replace(/\$\{selectedModel\}/g, 'ag/gemini-pro-agent');
fullBody = fullBody.replace(/\$\{isChat \? '0 0 14px rgba\(56,189,248,0\.6\)' : '0 2px 10px rgba\(14,165,233,0\.35\)'\}/g, '0 0 14px rgba(56,189,248,0.6)');
fullBody = fullBody.replace(/\$\{isChat \? 'display: none;' : ''\}/g, 'display: none;');
fullBody = fullBody.replace(/\$\{isChat \? 'display: block;' : 'display: none;'\}/g, 'display: block;');
fullBody = fullBody.replace(/\$\{isChat \? 'Show Hub' : 'Hide Hub'\}/g, 'Show Hub');

// ---------------------------------------------------------------------
// 4. APPLY USER-REQUESTED REFINEMENTS TO JS
// ---------------------------------------------------------------------

// Replace handleVoiceTurnInChat with strict separation
const oldVoiceTurnRegex = /function handleVoiceTurnInChat\(text,\s*turnComplete,\s*from\)\s*\{[\s\S]*?if\s*\(turnComplete\s*&&\s*voiceBox\)\s*\{\s*voiceBox\.removeAttribute\('id'\);\s*\}\s*\}/;

const newVoiceTurnFunc = `function handleVoiceTurnInChat(text, turnComplete, from) {
      const isUser = from === 'user';
      const activeId = isUser ? 'active_live_user_bubble' : 'active_live_ai_bubble';
      const oppositeId = isUser ? 'active_live_ai_bubble' : 'active_live_user_bubble';

      // If turn is complete with no extra text, finalize active bubble
      if (!text && turnComplete) {
        const currentActive = document.getElementById(activeId);
        if (currentActive) currentActive.removeAttribute('id');
        return;
      }
      if (!text) return;

      const feed = document.getElementById('chatFeed');
      if (!feed) return;
      const welcome = document.getElementById('chatWelcomeCard');
      if (welcome) welcome.style.display = 'none';

      // Ensure any lingering opposite speaker bubble is closed so turns never concatenate
      const oppositeBubble = document.getElementById(oppositeId);
      if (oppositeBubble) {
        oppositeBubble.removeAttribute('id');
      }

      let voiceBox = document.getElementById(activeId);
      if (!voiceBox) {
        const row = document.createElement('div');
        row.className = 'chat-bubble-row ' + (isUser ? 'user-row' : 'ai-row');
        row.innerHTML =
          '<div class="chat-bubble-meta">' +
            '<span>' + (isUser ? '🎙️ You (Voice)' : '🎙️ Gemini Live (AI)') + '</span>' +
            '<span>•</span>' +
            '<span>' + new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) + '</span>' +
          '</div>' +
          '<div class="chat-bubble ' + (isUser ? 'user-bubble voice-user-bubble' : 'ai-bubble voice-ai-bubble') + '" id="' + activeId + '">' + escapeHtml(text) + '</div>';
        feed.appendChild(row);
        voiceBox = document.getElementById(activeId);
      } else {
        voiceBox.innerText += text;
      }

      feed.scrollTop = feed.scrollHeight;

      if (turnComplete && voiceBox) {
        voiceBox.removeAttribute('id');
      }
    }`;

fullJs = fullJs.replace(oldVoiceTurnRegex, newVoiceTurnFunc);

// Prevent scrollIntoView from moving the window
fullJs = fullJs.replace(
  /input\.scrollIntoView\(\{\s*behavior:\s*'smooth',\s*block:\s*'center'\s*\}\);/g,
  `const feed = document.getElementById('chatFeed'); if (feed) feed.scrollTop = feed.scrollHeight;`
);

// Save app.js
fs.writeFileSync(path.join(uiDevDir, 'app.js'), fullJs, 'utf8');
console.log('Saved ui-dev/app.js');

// ---------------------------------------------------------------------
// 5. ASSEMBLE ui-dev/index.html (WITH FULL INLINE <style> AND LINK FALLBACK)
// ---------------------------------------------------------------------
const mockState = JSON.parse(fs.readFileSync(path.join(uiDevDir, 'mock-state.json'), 'utf8'));

const indexHtml = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>9 Router: Control Center & Orchestrator (localhost:8888)</title>
  <!-- Inline style from extension to ensure 100% complete CSS is always rendered -->
  <style>
${fullCss}
${devBannerCss}
  </style>
  <link rel="stylesheet" href="style.css">
</head>
<body>
  <!-- Dev Server Status Banner -->
  <div id="uiDevBanner" class="ui-dev-banner">
    <div class="ui-dev-left">
      <span class="ui-dev-badge">⚡ 9 Router UI Dev Server</span>
      <span class="ui-dev-tag">Port: 8888</span>
      <span class="ui-dev-tag" id="devModelTag">Active Model: <strong>ag/gemini-pro-agent</strong></span>
      <span class="ui-dev-live"><span class="ui-dev-live-dot"></span> Live Reload Active</span>
    </div>
    <div class="ui-dev-right">
      <button class="btn btn-secondary" onclick="syncToExtension()" title="Sync your edited HTML/CSS/JS back into src/ui/workflowWebview.ts">🔄 Sync to Extension</button>
      <button class="btn btn-secondary" onclick="resetMockState()" title="Reset mock state back to default">🔁 Reset State</button>
      <button class="btn btn-secondary" onclick="document.getElementById('uiDevBanner').style.display='none'" title="Hide this banner">✕</button>
    </div>
  </div>

  <script id="initial-state" type="application/json">${JSON.stringify(mockState)}</script>

${fullBody}

  <script src="mock-vscode.js"></script>
  <script src="app.js"></script>
  <script>
    // Live Reload via SSE
    const evtSource = new EventSource('/api/live-reload');
    evtSource.onmessage = (event) => {
      if (event.data === 'reload') {
        console.log('[Dev Server] File changed! Reloading page...');
        window.location.reload();
      }
    };

    function syncToExtension() {
      fetch('/api/sync', { method: 'POST' })
        .then(r => r.json())
        .then(data => {
          if (data.success) {
            alert('✅ Successfully synced UI changes to src/ui/workflowWebview.ts!');
          } else {
            alert('❌ Sync error: ' + (data.error || 'Unknown error'));
          }
        })
        .catch(err => alert('Sync request failed: ' + err.message));
    }

    function resetMockState() {
      fetch('/api/reset-state', { method: 'POST' })
        .then(() => window.location.reload())
        .catch(err => console.error(err));
    }
  </script>
</body>
</html>
`;

fs.writeFileSync(path.join(uiDevDir, 'index.html'), indexHtml, 'utf8');
console.log('Saved ui-dev/index.html');

console.log('--- Rebuild Complete! ---');
