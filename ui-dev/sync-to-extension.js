const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

function syncUiToExtension(runCompile = true) {
  const rootDir = path.join(__dirname, '..');
  const uiDevDir = path.join(rootDir, 'ui-dev');
  const srcFile = path.join(rootDir, 'src', 'ui', 'workflowWebview.ts');

  let styleCss = fs.readFileSync(path.join(uiDevDir, 'style.css'), 'utf8');
  if (styleCss.includes('/* Dev Server Banner */')) {
    styleCss = styleCss.split('/* Dev Server Banner */')[0].trim();
  }

  let indexHtml = fs.readFileSync(path.join(uiDevDir, 'index.html'), 'utf8');
  const firstScriptIdx = indexHtml.indexOf('<script id="initial-state"');
  let bodyContent = '';
  if (firstScriptIdx !== -1) {
    const afterInit = indexHtml.indexOf('</script>', firstScriptIdx) + 9;
    const endBodyIdx = indexHtml.indexOf('<script src="mock-vscode.js">');
    bodyContent = indexHtml.slice(afterInit, endBodyIdx).trim();
    bodyContent = bodyContent.replace(/<div id="uiDevBanner"[\s\S]*?<\/div>\s*<\/div>/, '').trim();
  }

  let appJs = fs.readFileSync(path.join(uiDevDir, 'app.js'), 'utf8');

  // Convert static markup back to dynamic template literals
  bodyContent = bodyContent.replace(
    'Model: ag/gemini-pro-agent',
    'Model: ${selectedModel}'
  );
  bodyContent = bodyContent.replace(
    /box-shadow:\s*0 0 14px rgba\(56,189,248,0\.6\);/g,
    "box-shadow: ${isChat ? '0 0 14px rgba(56,189,248,0.6)' : '0 2px 10px rgba(14,165,233,0.35)'};"
  );
  bodyContent = bodyContent.replace(
    /<button class="tab-btn(?:\s+active)?" id="tabWorkflowBtn"/,
    '<button class="tab-btn ${isChat ? \'\' : \'active\'}" id="tabWorkflowBtn"'
  );
  bodyContent = bodyContent.replace(
    /<button class="tab-btn(?:\s+active)?" id="tabChatBtn"/,
    '<button class="tab-btn ${isChat ? \'active\' : \'\'}" id="tabChatBtn"'
  );
  bodyContent = bodyContent.replace(
    /<div class="qa-grid" id="qaGrid" style="[^"]*">/,
    '<div class="qa-grid" id="qaGrid" style="${isChat ? \'display: none;\' : \'\'}">'
  );
  bodyContent = bodyContent.replace(
    /<div id="workflowTab" class="tab-content" style="[^"]*">/,
    '<div id="workflowTab" class="tab-content" style="${isChat ? \'display: none;\' : \'\'}">'
  );
  bodyContent = bodyContent.replace(
    /<div id="chatTab" class="tab-content" style="[^"]*">/,
    '<div id="chatTab" class="tab-content" style="${isChat ? \'display: block;\' : \'display: none;\'}">'
  );
  bodyContent = bodyContent.replace(
    /<button class="btn btn-secondary" data-action="toggleQuickHub" onclick="toggleQuickHub\(\)" id="qaToggleBtn"[^>]*>.*?<\/button>/,
    '<button class="btn btn-secondary" data-action="toggleQuickHub" onclick="toggleQuickHub()" id="qaToggleBtn" style="font-size: 11px; padding: 3px 9px;">${isChat ? \'Show Hub\' : \'Hide Hub\'}</button>'
  );

  // Escape JS for template literal insertion
  let templateJs = appJs.replace(/\\'/g, "\\\\'");
  templateJs = templateJs.replace(/\\"/g, '\\\\"');
  templateJs = templateJs.replace(
    "let currentSelectedModel = 'ag/gemini-pro-agent';",
    "let currentSelectedModel = '${selectedModel}';"
  );

  const srcContent = fs.readFileSync(srcFile, 'utf8');
  const lines = srcContent.split('\n');

  let styleStart = -1, styleEnd = -1;
  let scriptStart = -1, scriptEnd = -1;

  for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes('<style>') && styleStart === -1) styleStart = i + 1;
    if (lines[i].includes('</style>') && styleEnd === -1) styleEnd = i;
    if (lines[i].includes('<script nonce="${nonce}">') && scriptStart === -1) scriptStart = i + 1;
  }

  for (let i = lines.length - 1; i >= 0; i--) {
    if (lines[i].includes('</script>')) {
      scriptEnd = i;
      break;
    }
  }

  let bodyStart = -1;
  for (let i = styleEnd; i < scriptStart; i++) {
    if (lines[i].includes('<script id="initial-state"')) {
      bodyStart = i + 1;
      break;
    }
  }

  if (styleStart === -1 || styleEnd === -1 || scriptStart === -1 || scriptEnd === -1 || bodyStart === -1) {
    throw new Error('Could not identify all code boundaries in workflowWebview.ts');
  }

  const prefix = lines.slice(0, styleStart).join('\n');
  const mid1 = lines.slice(styleEnd, bodyStart).join('\n');
  const mid2 = lines.slice(scriptStart - 1, scriptStart).join('\n');
  const suffix = lines.slice(scriptEnd).join('\n');

  const newContent = [
    prefix,
    styleCss,
    mid1,
    bodyContent,
    mid2,
    templateJs,
    suffix
  ].join('\n');

  fs.writeFileSync(srcFile, newContent, 'utf8');
  console.log('✅ Updated src/ui/workflowWebview.ts (' + newContent.length + ' bytes)');

  if (runCompile) {
    console.log('📦 Running npm run compile...');
    try {
      execSync('npm run compile', { cwd: rootDir, stdio: 'inherit' });
      console.log('✨ Build succeeded!');
    } catch (err) {
      console.warn('⚠️ Compilation warning/error:', err.message);
    }
  }

  return { success: true };
}

if (require.main === module) {
  try {
    syncUiToExtension(true);
  } catch (e) {
    console.error('❌ Sync failed:', e);
    process.exit(1);
  }
}

module.exports = { syncUiToExtension };
