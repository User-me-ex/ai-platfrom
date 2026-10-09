const fs = require('fs');
const path = require('path');

const rootDir = path.join(__dirname, '..');
const appJsPath = path.join(rootDir, 'ui-dev', 'app.js');
const indexHtmlPath = path.join(rootDir, 'ui-dev', 'index.html');

// 1. Update app.js
let appJs = fs.readFileSync(appJsPath, 'utf8');

// Replace toggle functions
const oldToggleBlock = `    function togglePipelineGraph() {
      isPipelineGraphCollapsed = !isPipelineGraphCollapsed;
      const body = document.getElementById('chatSerialGraphBody');
      const btn  = document.getElementById('graphCollapseBtn');
      if (body) body.classList.toggle('graph-collapsed', isPipelineGraphCollapsed);
      if (btn)  btn.classList.toggle('collapsed', isPipelineGraphCollapsed);
      if (btn)  btn.title = isPipelineGraphCollapsed ? 'Expand pipeline graph' : 'Collapse pipeline graph';
    }

    function toggleChatHeader() {
      isChatHeaderCollapsed = !isChatHeaderCollapsed;
      const body = document.getElementById('chatHeaderBody');
      const btn  = document.getElementById('chatHeaderToggleBtn');
      if (body) body.classList.toggle('hdr-collapsed', isChatHeaderCollapsed);
      if (btn)  btn.classList.toggle('hdr-collapsed', isChatHeaderCollapsed);
      if (btn)  btn.title = isChatHeaderCollapsed ? 'Expand header' : 'Collapse header';
    }`;

const newToggleBlock = `    let lastChatHeaderToggle = 0;
    let lastPipelineGraphToggle = 0;

    function togglePipelineGraph(e) {
      if (e) {
        if (typeof e.stopPropagation === 'function') e.stopPropagation();
        if (typeof e.preventDefault === 'function') e.preventDefault();
      }
      const now = Date.now();
      if (now - lastPipelineGraphToggle < 180) return;
      lastPipelineGraphToggle = now;

      isPipelineGraphCollapsed = !isPipelineGraphCollapsed;
      const body = document.getElementById('chatSerialGraphBody');
      const btn  = document.getElementById('graphCollapseBtn');
      if (body) body.classList.toggle('graph-collapsed', isPipelineGraphCollapsed);
      if (btn) {
        btn.classList.toggle('collapsed', isPipelineGraphCollapsed);
        btn.title = isPipelineGraphCollapsed ? 'Expand pipeline graph' : 'Collapse pipeline graph';
        const ch = btn.querySelector('.chevron');
        if (ch) ch.innerHTML = isPipelineGraphCollapsed ? '&#9660;' : '&#9650;';
      }
    }

    function toggleChatHeader(e) {
      if (e) {
        if (typeof e.stopPropagation === 'function') e.stopPropagation();
        if (typeof e.preventDefault === 'function') e.preventDefault();
      }
      const now = Date.now();
      if (now - lastChatHeaderToggle < 180) return;
      lastChatHeaderToggle = now;

      isChatHeaderCollapsed = !isChatHeaderCollapsed;
      const body = document.getElementById('chatHeaderBody');
      const btn  = document.getElementById('chatHeaderToggleBtn');
      if (body) {
        body.classList.toggle('hdr-collapsed', isChatHeaderCollapsed);
      }
      if (btn) {
        btn.classList.toggle('hdr-collapsed', isChatHeaderCollapsed);
        btn.title = isChatHeaderCollapsed ? 'Expand header' : 'Collapse header';
        const ch = btn.querySelector('.hdr-chevron');
        if (ch) ch.innerHTML = isChatHeaderCollapsed ? '&#9660;' : '&#9650;';
      }
    }`;

// Normalize line endings for replacement
appJs = appJs.replace(/\r\n/g, '\n');
const normalizedOld = oldToggleBlock.replace(/\r\n/g, '\n');

if (appJs.includes(normalizedOld)) {
  appJs = appJs.replace(normalizedOld, newToggleBlock);
  console.log('✅ Replaced toggle functions with debounced versions.');
} else {
  console.warn('⚠️ Could not find exact oldToggleBlock in app.js, checking with regex');
  appJs = appJs.replace(/function togglePipelineGraph\(\)[\s\S]*?function toggleChatHeader\(\)[\s\S]*?\n    \}/, newToggleBlock);
}

// Ensure ACTION_MAP includes toggleChatHeader and togglePipelineGraph
if (!appJs.includes('toggleChatHeader: function')) {
  appJs = appJs.replace(
    'toggleQuickHub: function() { toggleQuickHub(); },',
    `toggleQuickHub: function() { toggleQuickHub(); },\n      toggleChatHeader: function(arg, el) { toggleChatHeader(); },\n      togglePipelineGraph: function(arg, el) { togglePipelineGraph(); },`
  );
  console.log('✅ Added toggleChatHeader and togglePipelineGraph to ACTION_MAP.');
}

// Ensure window exports include togglePipelineGraph
if (!appJs.includes('window.togglePipelineGraph = togglePipelineGraph;')) {
  appJs = appJs.replace(
    'window.toggleChatHeader = toggleChatHeader;',
    'window.toggleChatHeader = toggleChatHeader;\n    window.togglePipelineGraph = togglePipelineGraph;'
  );
  console.log('✅ Added window.togglePipelineGraph export.');
}

// Deduplicate in executeRawOnclick
if (!appJs.includes('el._clickHandled && (Date.now() - el._clickHandled < 250)')) {
  appJs = appJs.replace(
    'function executeRawOnclick(raw, el) {\n      if (!raw) return;',
    `function executeRawOnclick(raw, el) {\n      if (!raw) return;\n      if (el && el._clickHandled && (Date.now() - el._clickHandled < 250)) return;\n      if (el) el._clickHandled = Date.now();`
  );
  console.log('✅ Added deduplication to executeRawOnclick.');
}

// Deduplicate in document.addEventListener('click')
if (!appJs.includes('actionEl._clickHandled = Date.now()')) {
  appJs = appJs.replace(
    'ACTION_MAP[action](param, actionEl);\n          e.preventDefault();\n          return;',
    `actionEl._clickHandled = Date.now();\n          ACTION_MAP[action](param, actionEl);\n          e.preventDefault();\n          e.stopPropagation();\n          return;`
  );
  console.log('✅ Added stopPropagation and deduplication to data-action handler.');
}

fs.writeFileSync(appJsPath, appJs, 'utf8');

// 2. Update index.html
let indexHtml = fs.readFileSync(indexHtmlPath, 'utf8').replace(/\r\n/g, '\n');

// Update chatHeaderToggleBtn
indexHtml = indexHtml.replace(
  '<button id="chatHeaderToggleBtn" onclick="toggleChatHeader()" title="Collapse header">',
  '<button id="chatHeaderToggleBtn" data-action="toggleChatHeader" onclick="toggleChatHeader(event)" title="Collapse header">'
);

// Add graphCollapseBtn if missing
if (!indexHtml.includes('id="graphCollapseBtn"')) {
  indexHtml = indexHtml.replace(
    '<span id="graphStepCountText" style="font-size: 11px; color: var(--fg-muted);">0 / 0 steps</span>',
    `<div style="display: flex; align-items: center; gap: 6px;">\n                  <span id="graphStepCountText" style="font-size: 11px; color: var(--fg-muted);">0 / 0 steps</span>\n                  <button id="graphCollapseBtn" data-action="togglePipelineGraph" onclick="togglePipelineGraph(event)" title="Collapse pipeline graph" style="display: inline-flex;">\n                    <span class="chevron">&#9650;</span>\n                  </button>\n                </div>`
  );
  console.log('✅ Added graphCollapseBtn to index.html.');
}

fs.writeFileSync(indexHtmlPath, indexHtml, 'utf8');
console.log('✅ Files updated successfully.');
