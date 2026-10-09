const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const rootDir = path.join(__dirname, '..');
const appJsPath = path.join(rootDir, 'ui-dev', 'app.js');

let code = fs.readFileSync(appJsPath, 'utf8');

// Replace all occurrences of \\'' with \''
// In raw file text, \\'' is two backslash characters and two single quote characters.
// We want one backslash character and two single quote characters: \''
code = code.split("\\\\''").join("\\''");

// Also check for \\\\'
code = code.split("\\\\\\'").join("\\'");

fs.writeFileSync(appJsPath, code, 'utf8');

try {
  execSync('node -c ui-dev/app.js', { cwd: rootDir, stdio: 'pipe' });
  console.log('🎉 100% SUCCESS: ui-dev/app.js IS SYNTAX VALID!');
} catch (err) {
  console.error('❌ Error checking syntax:\n' + err.stderr.toString());
}
