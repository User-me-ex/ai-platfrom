const fs = require('fs');
const path = require('path');

const rootDir = path.join(__dirname, '..');
const uiDevDir = path.join(rootDir, 'ui-dev');

// 1. UPDATE ui-dev/app.js
const appJsPath = path.join(uiDevDir, 'app.js');
let appJs = fs.readFileSync(appJsPath, 'utf8');

// Update toggleQuickHub
appJs = appJs.replace(
  /function toggleQuickHub\(\) \{[\s\S]*?btn\.innerText = 'Show Hub';\s*\}\s*\}/,
  `function toggleQuickHub() {
      const grid = document.getElementById('qaGrid');
      const btn = document.getElementById('qaToggleBtn');
      if (!grid || !btn) return;
      const isHidden = grid.style.display === 'none' || window.getComputedStyle(grid).display === 'none';
      if (isHidden) {
        grid.style.display = 'grid';
        btn.innerText = 'Hide Hub';
      } else {
        grid.style.display = 'none';
        btn.innerText = 'Show Hub';
      }
    }`
);

// Add window exports for toggleChatHeader & togglePipelineGraph
if (!appJs.includes('window.toggleChatHeader = toggleChatHeader;')) {
  appJs = appJs.replace(
    'window.toggleQuickHub = toggleQuickHub;',
    `window.toggleQuickHub = toggleQuickHub;\n    window.toggleChatHeader = toggleChatHeader;\n    window.togglePipelineGraph = togglePipelineGraph;`
  );
}

// Add ACTION_MAP entries for toggleChatHeader & togglePipelineGraph
if (!appJs.includes('toggleChatHeader: function() { toggleChatHeader(); }')) {
  appJs = appJs.replace(
    'toggleQuickHub: function() { toggleQuickHub(); },',
    `toggleQuickHub: function() { toggleQuickHub(); },\n      toggleChatHeader: function() { toggleChatHeader(); },\n      togglePipelineGraph: function() { togglePipelineGraph(); },`
  );
}

// Prevent double execution in delegated click listener
appJs = appJs.replace(
  /const onclickEl = e\.target\.closest\('\[onclick\]'\);\s*if \(onclickEl\) \{\s*const raw = onclickEl\.getAttribute\('onclick'\);\s*if \(raw\) \{\s*executeRawOnclick\(raw, onclickEl\);\s*\}\s*\}/,
  `const onclickEl = e.target.closest('[onclick]');
      if (onclickEl && !actionEl) {
        // If native inline onclick was already fired by browser, do not double-invoke
        if (typeof onclickEl.onclick === 'function') {
          return;
        }
        const raw = onclickEl.getAttribute('onclick');
        if (raw) {
          executeRawOnclick(raw, onclickEl);
        }
      }`
);

fs.writeFileSync(appJsPath, appJs, 'utf8');
console.log('Updated ui-dev/app.js successfully');

// 2. UPDATE ui-dev/index.html
const indexHtmlPath = path.join(uiDevDir, 'index.html');
let indexHtml = fs.readFileSync(indexHtmlPath, 'utf8');

// Update qaToggleBtn to use data-action exclusively
indexHtml = indexHtml.replace(
  /<button class="btn btn-secondary" data-action="toggleQuickHub" onclick="toggleQuickHub\(\)" id="qaToggleBtn"[^>]*>Show Hub<\/button>/,
  '<button class="btn btn-secondary" data-action="toggleQuickHub" id="qaToggleBtn" style="font-size: 11px; padding: 3px 9px;">Show Hub</button>'
);

// Update chatHeaderToggleBtn to use data-action
indexHtml = indexHtml.replace(
  /<button id="chatHeaderToggleBtn" onclick="toggleChatHeader\(\)" title="Collapse header">/,
  '<button id="chatHeaderToggleBtn" data-action="toggleChatHeader" title="Collapse header">'
);

// Update graphCollapseBtn to use data-action
indexHtml = indexHtml.replace(
  /<button id="graphCollapseBtn" onclick="togglePipelineGraph\(\)" title="Collapse \/ expand pipeline graph">/,
  '<button id="graphCollapseBtn" data-action="togglePipelineGraph" title="Collapse / expand pipeline graph">'
);

fs.writeFileSync(indexHtmlPath, indexHtml, 'utf8');
console.log('Updated ui-dev/index.html successfully');
