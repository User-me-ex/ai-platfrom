const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const rootDir = path.join(__dirname, '..');
const originalFile = execSync('git show HEAD:src/ui/workflowWebview.ts', { maxBuffer: 15 * 1024 * 1024 }).toString('utf8');

console.log('Original git HEAD workflowWebview.ts length:', originalFile.length);

// Extract style
const styleStart = originalFile.indexOf('<style>') + '<style>'.length;
const styleEnd = originalFile.indexOf('</style>', styleStart);
const originalStyle = originalFile.slice(styleStart, styleEnd).trim();

console.log('Original style extracted, length:', originalStyle.length);

// Extract HTML body
// Body starts after </head>\n<body> or after <script id="initial-state"
const bodyTagStart = originalFile.indexOf('<body>', styleEnd) + '<body>'.length;
const scriptTagStart = originalFile.indexOf('<script nonce="${nonce}">', bodyTagStart);
const originalBody = originalFile.slice(bodyTagStart, scriptTagStart).trim();

console.log('Original body extracted, length:', originalBody.length);

// Extract JS
const scriptTagEnd = originalFile.lastIndexOf('</script>');
const originalJs = originalFile.slice(scriptTagStart + '<script nonce="${nonce}">'.length, scriptTagEnd).trim();

console.log('Original script extracted, length:', originalJs.length);
