const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const rootDir = path.join(__dirname, '..');
const appJsPath = path.join(rootDir, 'ui-dev', 'app.js');

let content = fs.readFileSync(appJsPath, 'utf8');

// Replace \\'' with \'
content = content.split("\\\\''").join("\\'");
// Replace \\\\\\' with \'
content = content.split("\\\\\\'").join("\\'");
// Replace \\\\' with \'
content = content.split("\\\\'").join("\\'");

fs.writeFileSync(appJsPath, content, 'utf8');

try {
  execSync('node -c ui-dev/app.js', { cwd: rootDir, stdio: 'pipe' });
  console.log('🎉 SUCCESS: ui-dev/app.js syntax is 100% VALID!');
} catch (err) {
  console.error('❌ Still error:\n', err.stderr.toString());
}
