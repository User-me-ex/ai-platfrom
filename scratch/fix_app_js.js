const fs = require('fs');
const path = require('path');

const rootDir = path.join(__dirname, '..');
const srcFile = path.join(rootDir, 'src', 'ui', 'workflowWebview.ts');
const appJsPath = path.join(rootDir, 'ui-dev', 'app.js');

const lines = fs.readFileSync(srcFile, 'utf8').split('\n');

let scriptStart = -1, scriptEnd = -1;
for (let i = 0; i < lines.length; i++) {
  if (lines[i].includes('<script nonce="${nonce}">')) scriptStart = i + 1;
  if (lines[i].includes('</script>') && i > 4000) scriptEnd = i;
}

let scriptRaw = lines.slice(scriptStart, scriptEnd).join('\n');

// In template literal, double backslashes before quotes were template escapes
// e.g. \\' -> \'
// Let's replace \\' with \'
scriptRaw = scriptRaw.replace(/\\\\'/g, "\\'");
scriptRaw = scriptRaw.replace(/\\\\"/g, '\\"');
scriptRaw = scriptRaw.replace(/\$\{selectedModel\}/g, 'ag/gemini-pro-agent');

fs.writeFileSync(appJsPath, scriptRaw, 'utf8');

// Now test syntax
const { execSync } = require('child_process');
try {
  execSync('node --check "' + appJsPath + '"', { stdio: 'inherit' });
  console.log('✅ app.js syntax check passed!');
} catch (err) {
  console.error('❌ Syntax check failed');
}
