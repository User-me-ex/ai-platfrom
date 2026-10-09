const fs = require('fs');
const path = require('path');

const rootDir = path.join(__dirname, '..');
const appJsPath = path.join(rootDir, 'ui-dev', 'app.js');
const indexHtmlPath = path.join(rootDir, 'ui-dev', 'index.html');

// 1. Update index.html
let html = fs.readFileSync(indexHtmlPath, 'utf8').replace(/\r\n/g, '\n');

// Replace compact mode pill
html = html.replace(
  '<span class="compact-mode-pill" id="compactModePill">⚡ Autonomous Pipeline</span>',
  '<span class="compact-mode-pill" id="compactModePill">⚡ Autonomous Pipeline &amp; Chat <span class="badge" style="background: rgba(34,197,94,0.15); color: #4ade80; font-size: 9.5px; margin-left: 4px;">TEXT MODE</span></span>'
);

// Replace chat-mode-toggle in header body with unified title badge
const oldToggle = `<div class="chat-mode-toggle" id="chatModeToggle">
                <button id="modePipelineBtn" class="chat-mode-btn active" data-action="setChatMode" data-param="pipeline" onclick="setChatMode('pipeline')" title="Autonomous AI Multi-Role Pipeline: orchestrates specialized roles 1-by-1 in serial">
                  <span>⚡</span> <span>Autonomous Pipeline</span>
                </button>
                <button id="modeDirectBtn" class="chat-mode-btn" data-action="setChatMode" data-param="direct" onclick="setChatMode('direct')" title="Direct 1-on-1 Text Mode: Chat with your chosen 9 Router model">
                  <span>💬</span> <span>Chat with Selected Model</span>
                  <span class="badge" style="background: rgba(56,189,248,0.2); color: #38bdf8; font-size: 9.5px; margin-left: 4px;">Text Mode</span>
                </button>
              </div>`;

const newUnifiedHeader = `<div class="chat-unified-pill" id="chatModeToggle" style="display: inline-flex; align-items: center; gap: 8px; background: rgba(15,23,42,0.8); border: 1px solid rgba(56,189,248,0.3); padding: 5px 12px; border-radius: 8px;">
                <span style="font-size: 12.5px; font-weight: 600; color: #f8fafc; display: flex; align-items: center; gap: 6px;">
                  <span style="color: #38bdf8;">⚡</span> Autonomous Pipeline &amp; Chat
                </span>
                <span class="badge" style="background: rgba(34,197,94,0.2); color: #4ade80; font-size: 9.5px; font-weight: 600; border: 1px solid rgba(34,197,94,0.3);">TEXT MODE</span>
              </div>`;

if (html.includes(oldToggle)) {
  html = html.replace(oldToggle, newUnifiedHeader);
  console.log('✅ Replaced dual mode buttons with unified header badge in index.html');
} else {
  console.warn('⚠️ Could not find exact oldToggle, attempting regex replacement');
  html = html.replace(/<div class="chat-mode-toggle" id="chatModeToggle">[\s\S]*?<\/div>/, newUnifiedHeader);
}

// Remove redundant chatDirectModeBanner if present
html = html.replace(/<!-- Dynamic Text Mode Banner \(visible in Direct Mode\) -->\s*<div id="chatDirectModeBanner"[\s\S]*?<\/div>\s*<\/div>/, '</div>');

// Update welcome card
html = html.replace(
  '<h3 id="chatWelcomeTitle" style="font-size: 15px; font-weight: 600; margin-bottom: 6px;">Autonomous AI Role Orchestrator & Chat</h3>',
  '<h3 id="chatWelcomeTitle" style="font-size: 15px; font-weight: 600; margin-bottom: 6px;">Autonomous AI Pipeline &amp; Direct Chat (Text Mode)</h3>'
);

html = html.replace(
  'In <strong>Autonomous Pipeline</strong> mode, enter a requirement to decompose and execute serial roles with real-time graph updates. Switch to <strong>Chat with Selected Model</strong> to converse directly with your chosen 9 Router model.',
  'Unified workspace: converse directly with your model in <strong>Text Mode</strong>, or enter any software requirement to automatically orchestrate serial roles (Database → Backend → Frontend → Testing).'
);

// Update placeholder
html = html.replace(
  'placeholder="Instruction or goal… [Enter to Send, Shift+Enter for newline]"',
  'placeholder="Ask a question or enter a task (e.g. \'Build REST API\' or \'Explain this code\')… [Enter to Send, Shift+Enter for newline]"'
);

// Update inputBarModePill and text
html = html.replace(
  '<span id="inputBarModePill" class="badge" style="background: rgba(56,189,248,0.15); color: #38bdf8; font-size: 9.5px; padding: 1px 6px;">&#x26A1; Autonomous Pipeline</span>',
  '<span id="inputBarModePill" class="badge" style="background: rgba(56,189,248,0.15); color: #38bdf8; font-size: 9.5px; padding: 1px 6px;">⚡ Autonomous Pipeline &amp; Chat · TEXT MODE</span>'
);

html = html.replace(
  '<span id="inputBarModelText" style="font-size: 10px;">Decomposing into serial specialized roles</span>',
  '<span id="inputBarModelText" style="font-size: 10px;">Direct 1-on-1 Text Mode &amp; Autonomous Pipeline</span>'
);

// Update Send button row to offer both [⚡ Run Pipeline] and [💬 Send Chat]
const oldSendBtn = `<button class="btn btn-gradient" id="sendChatBtn" data-action="submitChatMessage" onclick="submitChatMessage()" style="height: 28px; padding: 0 14px; font-size: 11.5px; font-weight: 600; display: flex; align-items: center; gap: 4px; border-radius: 6px;" title="Send message (Enter)">
            <span>&#x1F680;</span> Send
          </button>`;

const newSendButtons = `<div style="display: flex; gap: 6px; align-items: center;">
            <button class="btn btn-secondary" id="runPipelineBtn" onclick="submitChatMessage('pipeline')" style="height: 28px; padding: 0 10px; font-size: 11px; font-weight: 500; display: flex; align-items: center; gap: 4px; border-radius: 6px; background: rgba(56,189,248,0.12); border: 1px solid rgba(56,189,248,0.3); color: #38bdf8;" title="Decompose requirement into serial specialized roles">
              <span>⚡</span> Run Pipeline
            </button>
            <button class="btn btn-gradient" id="sendChatBtn" data-action="submitChatMessage" onclick="submitChatMessage('direct')" style="height: 28px; padding: 0 14px; font-size: 11.5px; font-weight: 600; display: flex; align-items: center; gap: 4px; border-radius: 6px;" title="Direct 1-on-1 chat with selected model (Enter)">
              <span>💬</span> Send Chat
            </button>
          </div>`;

if (html.includes(oldSendBtn)) {
  html = html.replace(oldSendBtn, newSendButtons);
  console.log('✅ Updated Send buttons with [⚡ Run Pipeline] and [💬 Send Chat]');
} else {
  html = html.replace(/<button class="btn btn-gradient" id="sendChatBtn"[\s\S]*?<\/button>/, newSendButtons);
}

fs.writeFileSync(indexHtmlPath, html, 'utf8');

// 2. Update app.js
let appJs = fs.readFileSync(appJsPath, 'utf8').replace(/\r\n/g, '\n');

// Update submitChatMessage to accept an optional mode override
const oldSubmitChat = `    function submitChatMessage() {
      const input = document.getElementById('chatMessageInput');
      if (!input) return;
      const text = input.value.trim();
      if (!text) return;

      vscode.postMessage({
        command: 'chatSubmit',
        text,
        mode: currentChatMode,
        selectedModel: currentSelectedModel
      });

      input.value = '';
    }`;

const newSubmitChat = `    function submitChatMessage(overrideMode) {
      const input = document.getElementById('chatMessageInput');
      if (!input) return;
      const text = input.value.trim();
      if (!text) return;

      const effectiveMode = overrideMode || currentChatMode || 'direct';

      vscode.postMessage({
        command: 'chatSubmit',
        text,
        mode: effectiveMode,
        selectedModel: currentSelectedModel
      });

      input.value = '';
    }`;

if (appJs.includes(oldSubmitChat)) {
  appJs = appJs.replace(oldSubmitChat, newSubmitChat);
  console.log('✅ Updated submitChatMessage in app.js');
}

// Update setChatMode in app.js so it cleanly updates indicators
const oldSetChatMode = `    function setChatMode(mode) {
      currentChatMode = mode;
      const pBtn = document.getElementById('modePipelineBtn');
      const dBtn = document.getElementById('modeDirectBtn');
      const input = document.getElementById('chatMessageInput');
      const gWrap = document.getElementById('chatGraphWrapper');
      const wTitle = document.getElementById('chatWelcomeTitle');
      const wDesc = document.getElementById('chatWelcomeDesc');
      const banner = document.getElementById('chatDirectModeBanner');
      const bannerModel = document.getElementById('chatBannerModelName');
      const modePill = document.getElementById('inputBarModePill');
      const modeModelText = document.getElementById('inputBarModelText');
      const modelNameEl = document.getElementById('inputBarModelName');

      if (pBtn) pBtn.classList.toggle('active', mode === 'pipeline');
      if (dBtn) dBtn.classList.toggle('active', mode === 'direct');

      if (bannerModel) bannerModel.innerText = currentSelectedModel;
      if (modelNameEl) modelNameEl.innerText = currentSelectedModel;

      if (mode === 'pipeline') {
        if (input) input.placeholder = "Type your instruction or goal (e.g. 'Build REST API for products and write unit tests')… [Enter to Send, Shift+Enter for newline]";
        if (gWrap) gWrap.style.opacity = '1';
        if (wTitle) wTitle.innerText = 'Autonomous AI Role Orchestrator';
        if (wDesc) wDesc.innerHTML = 'In <strong>Autonomous Pipeline</strong> mode, enter a requirement to autonomously decompose and execute serial roles with real-time graph updates.';
        if (banner) banner.style.display = 'none';
        if (modePill) {
          modePill.innerText = '⚡ Autonomous Pipeline';
          modePill.style.background = 'rgba(56,189,248,0.15)';
          modePill.style.color = '#38bdf8';
        }
        if (modeModelText) modeModelText.innerText = 'Decomposing into serial specialized roles';
      } else {
        if (input) input.placeholder = "Chat with " + currentSelectedModel + " (normal text mode)… [Enter to Send, Shift+Enter for newline]";
        if (gWrap) gWrap.style.opacity = '0.7';
        if (wTitle) wTitle.innerText = 'Direct Chat with ' + currentSelectedModel;
        if (wDesc) wDesc.innerHTML = 'In <strong>Chat with Selected Model (Text Mode)</strong>, you converse directly with <strong>' + escapeHtml(currentSelectedModel) + '</strong> from 9 Router. You can change your selected model anytime using the dropdown or 9 Router model picker.';
        if (banner) banner.style.display = 'flex';
        if (modePill) {
          modePill.innerText = '💬 Text Mode (Chat with Selected Model)';
          modePill.style.background = 'rgba(34,197,94,0.15)';
          modePill.style.color = '#4ade80';
        }
        if (modeModelText) modeModelText.innerText = '1-on-1 direct conversation with tools active';
      }

      syncCompactBar(mode, null, null, null);
    }`;

const newSetChatMode = `    function setChatMode(mode) {
      currentChatMode = mode || 'direct';
      const input = document.getElementById('chatMessageInput');
      const modelNameEl = document.getElementById('inputBarModelName');
      const modePill = document.getElementById('inputBarModePill');

      if (modelNameEl) modelNameEl.innerText = currentSelectedModel;
      if (modePill) {
        modePill.innerHTML = '⚡ Autonomous Pipeline &amp; Chat · <span style="color:#4ade80;">TEXT MODE</span>';
      }
      if (input) {
        input.placeholder = "Ask a question or enter a task (e.g. 'Build REST API' or 'Explain this code')… [Enter to Send, Shift+Enter for newline]";
      }
      syncCompactBar(currentChatMode, null, null, null);
    }`;

if (appJs.includes(oldSetChatMode)) {
  appJs = appJs.replace(oldSetChatMode, newSetChatMode);
  console.log('✅ Updated setChatMode in app.js');
}

// Update syncCompactBar
appJs = appJs.replace(
  `pill.textContent = '\\uD83D\\uDCAC Chat with Model';`,
  `pill.innerHTML = '⚡ Autonomous Pipeline &amp; Chat · <span style="color:#4ade80;">TEXT MODE</span>';`
);
appJs = appJs.replace(
  `pill.textContent = '\\u26A1 Autonomous Pipeline';`,
  `pill.innerHTML = '⚡ Autonomous Pipeline &amp; Chat · <span style="color:#4ade80;">TEXT MODE</span>';`
);

fs.writeFileSync(appJsPath, appJs, 'utf8');
console.log('✅ Saved app.js successfully.');
