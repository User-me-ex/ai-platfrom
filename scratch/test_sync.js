const fs = require('fs');
const path = require('path');

function syncUiToExtension() {
  const rootDir = path.join(__dirname, '..');
  const uiDevDir = path.join(rootDir, 'ui-dev');
  const srcFile = path.join(rootDir, 'src', 'ui', 'workflowWebview.ts');

  let styleCss = fs.readFileSync(path.join(uiDevDir, 'style.css'), 'utf8');
  // Strip out dev banner CSS if present
  if (styleCss.includes('/* Dev Server Banner */')) {
    styleCss = styleCss.split('/* Dev Server Banner */')[0].trim();
  }

  let indexHtml = fs.readFileSync(path.join(uiDevDir, 'index.html'), 'utf8');
  // Extract body content between initial-state script and first script tag
  const startMarker = '</script>'; // after initial-state
  const firstScriptIdx = indexHtml.indexOf('<script id="initial-state"');
  let bodyContent = '';
  if (firstScriptIdx !== -1) {
    const afterInit = indexHtml.indexOf('</script>', firstScriptIdx) + 9;
    const endBodyIdx = indexHtml.indexOf('<script src="mock-vscode.js">');
    bodyContent = indexHtml.slice(afterInit, endBodyIdx).trim();
    // Strip dev banner html
    bodyContent = bodyContent.replace(/<div id="uiDevBanner"[\s\S]*?<\/div>\s*<\/div>/, '').trim();
  }

  let appJs = fs.readFileSync(path.join(uiDevDir, 'app.js'), 'utf8');

  // Now update src/ui/workflowWebview.ts
  const srcContent = fs.readFileSync(srcFile, 'utf8');
  const lines = srcContent.split('\n');

  let styleStart = -1, styleEnd = -1;
  let scriptStart = -1, scriptEnd = -1;

  for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes('<style>') && styleStart === -1) styleStart = i + 1;
    if (lines[i].includes('</style>') && styleEnd === -1) styleEnd = i;
    if (lines[i].includes('<script nonce="${nonce}">') && scriptStart === -1) scriptStart = i + 1;
    if (lines[i].includes('</script>') && i > 4000) scriptEnd = i;
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

  // Notice in appJs, replace hardcoded model back to interpolation if appropriate
  const newContent = [
    prefix,
    styleCss,
    mid1,
    bodyContent,
    mid2,
    appJs,
    suffix
  ].join('\n');

  // Verify it contains required markers
  if (!newContent.includes('export class WorkflowWebviewPanel') || !newContent.includes('<!DOCTYPE html>')) {
    throw new Error('Verification failed: exported class or html missing');
  }

  return { success: true, length: newContent.length };
}

console.log(syncUiToExtension());
