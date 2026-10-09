const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const rootDir = path.join(__dirname, '..');
const appJsPath = path.join(rootDir, 'ui-dev', 'app.js');

let code = fs.readFileSync(appJsPath, 'utf8');

// Replace all occurrences where \\' or \' was malformed in onclick/onchange handlers
// E.g.:
// onclick="openStepModal(\\' + ... + \\')
// onclick="openModelPicker(\\' + ... + \\', \\'primary\\')
// onchange="toggleRoleEnabled(\\' + ... + \\', this.checked)
// activateModel(\\' + ... + \\')
// selectModel(\\' + ... + \\')
// fillChatPrompt(\\'...\\')

// Use string replacement for each specific line that broke syntax:
code = code.replace(
  /'onclick="openStepModal\(\\'' \+ step\.id \+ '\\'\)"'/g,
  `'onclick="openStepModal(' + JSON.stringify(step.id) + ')"'`
);
code = code.replace(
  /'onclick="openStepModal\(\\'' \+ escapeHtml\(stepIdForModal\) \+ '\\'\)"'/g,
  `'onclick="openStepModal(' + JSON.stringify(stepIdForModal) + ')"'`
);
code = code.replace(
  /'onchange="toggleRoleEnabled\(\\'' \+ role\.id \+ '\\'', this\.checked\)"'/g,
  `'onchange="toggleRoleEnabled(' + JSON.stringify(role.id) + ', this.checked)"'`
);
code = code.replace(
  /'onclick="openModelPicker\(\\'' \+ role\.id \+ '\\'', \\\\?'primary\\\\?'\)"'/g,
  `'onclick="openModelPicker(' + JSON.stringify(role.id) + ', &apos;primary&apos;)"'`
);
code = code.replace(
  /'onclick="openModelPicker\(\\'' \+ role\.id \+ '\\'', \\\\?'fallback\\\\?'\)"'/g,
  `'onclick="openModelPicker(' + JSON.stringify(role.id) + ', &apos;fallback&apos;)"'`
);
code = code.replace(
  /'onclick="saveRoleCard\(\\'' \+ role\.id \+ '\\'\)"'/g,
  `'onclick="saveRoleCard(' + JSON.stringify(role.id) + ')"'`
);
code = code.replace(
  /'onclick="activateModel\(\\'' \+ escapeHtml\(m\.id\) \+ '\\'\)"'/g,
  `'onclick="activateModel(' + JSON.stringify(m.id) + ')"'`
);
code = code.replace(
  /'onclick="selectModel\(\\'' \+ escapeHtml\(m\.id\) \+ '\\'\)"'/g,
  `'onclick="selectModel(' + JSON.stringify(m.id) + ')"'`
);
code = code.replace(
  /'onclick="openStepModal\(\\'' \+ step\.id \+ '\\'\)"/g,
  `'onclick="openStepModal(' + JSON.stringify(step.id) + ')"`
);
code = code.replace(
  /'onclick="fillChatPrompt\(\\\\?'Build authentication system with OAuth2 and JWT tokens\\\\?'\)"'/g,
  `'onclick="fillChatPrompt(&apos;Build authentication system with OAuth2 and JWT tokens&apos;)"'`
);
code = code.replace(
  /'onclick="fillChatPrompt\(\\\\?'Create database schema and REST API endpoints\\\\?'\)"'/g,
  `'onclick="fillChatPrompt(&apos;Create database schema and REST API endpoints&apos;)"'`
);
code = code.replace(
  /'onclick="fillChatPrompt\(\\\\?'Audit codebase for vulnerabilities and write unit tests\\\\?'\)"'/g,
  `'onclick="fillChatPrompt(&apos;Audit codebase for vulnerabilities and write unit tests&apos;)"'`
);

fs.writeFileSync(appJsPath, code, 'utf8');

// Now check syntax with node
try {
  execSync('node -c ui-dev/app.js', { cwd: rootDir, stdio: 'pipe' });
  console.log('✅ ui-dev/app.js SYNTAX IS 100% VALID!');
} catch (err) {
  console.error('❌ Still has syntax error:\n', err.stderr.toString());
}
