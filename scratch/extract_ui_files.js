const fs = require('fs');
const path = require('path');

const srcFile = path.join(__dirname, '..', 'src', 'ui', 'workflowWebview.ts');
const outDir = path.join(__dirname, '..', 'ui-dev');

if (!fs.existsSync(outDir)) {
  fs.mkdirSync(outDir, { recursive: true });
}

const content = fs.readFileSync(srcFile, 'utf8');
const lines = content.split('\n');

// 1. Locate boundaries
let styleStart = -1, styleEnd = -1;
let scriptStart = -1, scriptEnd = -1;

for (let i = 0; i < lines.length; i++) {
  if (lines[i].includes('<style>') && styleStart === -1) styleStart = i + 1;
  if (lines[i].includes('</style>') && styleEnd === -1) styleEnd = i;
  if (lines[i].includes('<script nonce="${nonce}">') && scriptStart === -1) scriptStart = i + 1;
  if (lines[i].includes('</script>') && i > 4000) scriptEnd = i;
}

console.log('Style lines:', styleStart, 'to', styleEnd);
console.log('Script lines:', scriptStart, 'to', scriptEnd);

// 2. Extract CSS
const css = lines.slice(styleStart, styleEnd).join('\n');
fs.writeFileSync(path.join(outDir, 'style.css'), css, 'utf8');

// 3. Extract HTML markup (from after <script id="initial-state"> up to before client script)
// Find initial-state script line
let bodyStart = -1;
for (let i = styleEnd; i < scriptStart; i++) {
  if (lines[i].includes('<script id="initial-state"')) {
    bodyStart = i + 1;
    break;
  }
}
const htmlBody = lines.slice(bodyStart, scriptStart - 1).join('\n');

// 4. Extract JS
let js = lines.slice(scriptStart, scriptEnd).join('\n');
// In JS, replace '${selectedModel}' with currentSelectedModel default
js = js.replace(/\$\{selectedModel\}/g, 'ag/gemini-pro-agent');

fs.writeFileSync(path.join(outDir, 'app.js'), js, 'utf8');

console.log('Extracted style.css (', css.length, 'bytes)');
console.log('Extracted app.js (', js.length, 'bytes)');
console.log('Extracted html body (', htmlBody.length, 'bytes)');
