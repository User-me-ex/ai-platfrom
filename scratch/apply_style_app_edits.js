const fs = require('fs');
const path = require('path');

const rootDir = path.join(__dirname, '..');

// ----------------------------------------------------
// 1. UPDATE ui-dev/style.css
// ----------------------------------------------------
const styleCssPath = path.join(rootDir, 'ui-dev', 'style.css');
let styleCss = fs.readFileSync(styleCssPath, 'utf8');

// Replace body rule
styleCss = styleCss.replace(
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

// Add flex-shrink: 0 to header and quick-actions-section
styleCss = styleCss.replace(
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

styleCss = styleCss.replace(
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

// Tab content & Chat wrapper layout
styleCss = styleCss.replace(
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
styleCss = styleCss.replace(
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
styleCss = styleCss.replace(
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

// Chat input bar
styleCss = styleCss.replace(
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

// Voice transcript styles
if (!styleCss.includes('voice-user-bubble')) {
  styleCss = styleCss.replace(
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

fs.writeFileSync(styleCssPath, styleCss, 'utf8');
console.log('ui-dev/style.css updated successfully.');

// ----------------------------------------------------
// 2. UPDATE ui-dev/app.js
// ----------------------------------------------------
const appJsPath = path.join(rootDir, 'ui-dev', 'app.js');
let appJs = fs.readFileSync(appJsPath, 'utf8');

// Replace handleVoiceTurnInChat
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

if (oldVoiceTurnRegex.test(appJs)) {
  appJs = appJs.replace(oldVoiceTurnRegex, newVoiceTurnFunc);
} else {
  console.warn('Warning: oldVoiceTurnRegex did not match directly in app.js, checking alternate search');
}

// Remove scrollIntoView from switchTab and openChatInterface
appJs = appJs.replace(
  /input\.scrollIntoView\(\{\s*behavior:\s*'smooth',\s*block:\s*'center'\s*\}\);/g,
  `const feed = document.getElementById('chatFeed'); if (feed) feed.scrollTop = feed.scrollHeight;`
);

fs.writeFileSync(appJsPath, appJs, 'utf8');
console.log('ui-dev/app.js updated successfully.');

// ----------------------------------------------------
// 3. UPDATE ui-dev/sync-to-extension.js
// ----------------------------------------------------
const syncPath = path.join(rootDir, 'ui-dev', 'sync-to-extension.js');
let syncJs = fs.readFileSync(syncPath, 'utf8');

syncJs = syncJs.replace(
  /if \(lines\[i\]\.includes\('<\/script>'\) && i > 4000\) scriptEnd = i;/,
  `// will be assigned via reverse search`
);

syncJs = syncJs.replace(
  /let scriptStart = -1, scriptEnd = -1;/,
  `let scriptStart = -1, scriptEnd = -1;`
);

syncJs = syncJs.replace(
  /for \(let i = 0; i < lines\.length; i\+\+\) \{[\s\S]*?if \(lines\[i\]\.includes\('<script nonce="\$\{nonce\}">'\) && scriptStart === -1\) scriptStart = i \+ 1;\s*\}\s*/,
  `for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes('<style>') && styleStart === -1) styleStart = i + 1;
    if (lines[i].includes('</style>') && styleEnd === -1) styleEnd = i;
    if (lines[i].includes('<script nonce="\${nonce}">') && scriptStart === -1) scriptStart = i + 1;
  }
  for (let i = lines.length - 1; i >= 0; i--) {
    if (lines[i].includes('</script>')) {
      scriptEnd = i;
      break;
    }
  }
`
);

fs.writeFileSync(syncPath, syncJs, 'utf8');
console.log('ui-dev/sync-to-extension.js updated successfully.');
