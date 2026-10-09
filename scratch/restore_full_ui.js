const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const rootDir = path.join(__dirname, '..');
const uiDevDir = path.join(rootDir, 'ui-dev');
const srcWebviewPath = path.join(rootDir, 'src', 'ui', 'workflowWebview.ts');

console.log('--- 1. Restoring src/ui/workflowWebview.ts from git HEAD ---');
execSync('git checkout HEAD -- src/ui/workflowWebview.ts', { cwd: rootDir });
console.log('✅ Checked out pristine HEAD version of src/ui/workflowWebview.ts');

// Read pristine file
const pristineContent = fs.readFileSync(srcWebviewPath, 'utf8');
const lines = pristineContent.split('\n');

let styleStart = -1, styleEnd = -1, scriptStart = -1, scriptEnd = -1;
for (let i = 0; i < lines.length; i++) {
  if (lines[i].includes('<style>') && styleStart === -1) styleStart = i + 1;
  if (lines[i].includes('</style>') && styleEnd === -1) styleEnd = i;
  if (lines[i].includes('<script nonce="${nonce}">') && scriptStart === -1) scriptStart = i + 1;
  if (lines[i].includes('</script>') && i > 4000) scriptEnd = i;
}

// Line after initial-state
let bodyStart = -1;
for (let i = styleEnd; i < scriptStart; i++) {
  if (lines[i].includes('<script id="initial-state"')) {
    bodyStart = i + 1;
    break;
  }
}

console.log(`Boundaries: style ${styleStart}-${styleEnd}, body ${bodyStart}-${scriptStart}, script ${scriptStart}-${scriptEnd}`);

// 2. Extract CSS
const css = lines.slice(styleStart, styleEnd).join('\n');
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
  margin-bottom: 16px;
  font-size: 12px;
  color: #e2e8f0;
  backdrop-filter: blur(8px);
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
fs.writeFileSync(path.join(uiDevDir, 'style.css'), css + '\n' + devBannerCss, 'utf8');
console.log('✅ Written ui-dev/style.css');

// 3. Extract HTML Body
let bodyHtml = lines.slice(bodyStart, scriptStart).join('\n');
bodyHtml = bodyHtml.replace(/\$\{selectedModel\}/g, 'ag/gemini-pro-agent');
bodyHtml = bodyHtml.replace(/\$\{isChat \? '0 0 14px rgba\(56,189,248,0\.6\)' : '0 2px 10px rgba\(14,165,233,0\.35\)'\}/g, '0 0 14px rgba(56,189,248,0.6)');
bodyHtml = bodyHtml.replace(/\$\{isChat \? 'Show Hub' : 'Hide Hub'\}/g, 'Show Hub');
bodyHtml = bodyHtml.replace(/\$\{isChat \? 'display: none;' : ''\}/g, '');
bodyHtml = bodyHtml.replace(/\$\{isChat \? '' : 'active'\}/g, '');
bodyHtml = bodyHtml.replace(/\$\{isChat \? 'active' : ''\}/g, 'active');
bodyHtml = bodyHtml.replace(/\$\{isChat \? 'display: block;' : 'display: none;'\}/g, 'display: block;');

const mockState = JSON.parse(fs.readFileSync(path.join(uiDevDir, 'mock-state.json'), 'utf8'));
const stateJson = JSON.stringify(mockState).replace(/</g, '\\u003c');

const fullIndexHtml = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>9 Router: Control Center & Orchestrator (localhost:8888)</title>
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

  <script id="initial-state" type="application/json">${stateJson}</script>

${bodyHtml}

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
</html>`;

fs.writeFileSync(path.join(uiDevDir, 'index.html'), fullIndexHtml, 'utf8');
console.log('✅ Written ui-dev/index.html');

// 4. Extract JS and add debounce protections
let rawScript = lines.slice(scriptStart, scriptEnd).join('\n');
rawScript = rawScript.replace(/\\\\'/g, "\\'");
rawScript = rawScript.replace(/\\\\"/g, '\\"');
rawScript = rawScript.replace(/\$\{selectedModel\}/g, 'ag/gemini-pro-agent');

// Add debounce to toggleChatHeader and togglePipelineGraph so clicks don't double-fire
rawScript = rawScript.replace(
  'function togglePipelineGraph() {',
  `let lastPipelineGraphToggle = 0;
    function togglePipelineGraph(e) {
      if (e) {
        if (typeof e.stopPropagation === 'function') e.stopPropagation();
        if (typeof e.preventDefault === 'function') e.preventDefault();
      }
      const now = Date.now();
      if (now - lastPipelineGraphToggle < 180) return;
      lastPipelineGraphToggle = now;`
);

rawScript = rawScript.replace(
  'function toggleChatHeader() {',
  `let lastChatHeaderToggle = 0;
    function toggleChatHeader(e) {
      if (e) {
        if (typeof e.stopPropagation === 'function') e.stopPropagation();
        if (typeof e.preventDefault === 'function') e.preventDefault();
      }
      const now = Date.now();
      if (now - lastChatHeaderToggle < 180) return;
      lastChatHeaderToggle = now;`
);

// Ensure togglePipelineGraph is exported to window and ACTION_MAP
rawScript = rawScript.replace(
  'window.toggleChatHeader = toggleChatHeader;',
  'window.toggleChatHeader = toggleChatHeader;\n    window.togglePipelineGraph = togglePipelineGraph;'
);
rawScript = rawScript.replace(
  'toggleChatHeader: function() { toggleChatHeader(); },',
  'toggleChatHeader: function() { toggleChatHeader(); },\n      togglePipelineGraph: function() { togglePipelineGraph(); },'
);

// Ensure click deduplication in delegation
rawScript = rawScript.replace(
  'function executeRawOnclick(raw, el) {\n      if (!raw) return;',
  'function executeRawOnclick(raw, el) {\n      if (!raw) return;\n      if (el && el._clickHandled && (Date.now() - el._clickHandled < 250)) return;\n      if (el) el._clickHandled = Date.now();'
);

fs.writeFileSync(path.join(uiDevDir, 'app.js'), rawScript, 'utf8');
console.log('✅ Written ui-dev/app.js');

// Verify syntax
execSync('node --check "' + path.join(uiDevDir, 'app.js') + '"', { stdio: 'inherit' });
console.log('✅ app.js syntax check passed!');

// 5. Update src/ui/workflowWebview.ts with the debounced functions and sync cleanly
console.log('--- 5. Synchronizing and compiling extension ---');
execSync('node ui-dev/sync-to-extension.js', { cwd: rootDir, stdio: 'inherit' });
console.log('✅ Done full restoration!');
