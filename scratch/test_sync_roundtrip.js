const fs = require('fs');
const path = require('path');

const rootDir = path.join(__dirname, '..');
const appJsPath = path.join(rootDir, 'ui-dev', 'app.js');
let appJs = fs.readFileSync(appJsPath, 'utf8');

// When re-inserting appJs into template literal:
// Any \' in appJs should become \\' in template literal
let templateJs = appJs.replace(/\\'/g, "\\\\'");
templateJs = templateJs.replace(/\\"/g, '\\\\"');

// Check that backticks are escaped if any
// In original workflowWebview.ts, backticks in template literal were \`
templateJs = templateJs.replace(/`/g, '\\`');
// Also ${ should be \${ unless it's an intended interpolation
templateJs = templateJs.replace(/\$\{selectedModel\}/g, '${selectedModel}');

console.log('Template JS prepared, length:', templateJs.length);
