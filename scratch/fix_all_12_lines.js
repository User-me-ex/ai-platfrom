const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const rootDir = path.join(__dirname, '..');
const appJsPath = path.join(rootDir, 'ui-dev', 'app.js');

let code = fs.readFileSync(appJsPath, 'utf8');

// Line 497
code = code.replace(
  `onclick="openStepModal(\\' + step.id + \\')"`,
  `onclick="openStepModal(\\'' + step.id + '\\')"`
);

// Line 579
code = code.replace(
  `onchange="toggleRoleEnabled(\\' + role.id + \\', this.checked)"`,
  `onchange="toggleRoleEnabled(\\'' + role.id + '\\', this.checked)"`
);

// Line 588
code = code.replace(
  `onclick="openModelPicker(\\' + role.id + \\', \\'primary\\')"`,
  `onclick="openModelPicker(\\'' + role.id + '\\', \\'primary\\')"`
);

// Line 596
code = code.replace(
  `onclick="openModelPicker(\\' + role.id + \\', \\'fallback\\')"`,
  `onclick="openModelPicker(\\'' + role.id + '\\', \\'fallback\\')"`
);

// Line 607
code = code.replace(
  `onclick="saveRoleCard(\\' + role.id + \\')"`,
  `onclick="saveRoleCard(\\'' + role.id + '\\')"`
);

// Line 706
code = code.replace(
  `onclick="activateModel(\\' + escapeHtml(m.id) + \\')"`,
  `onclick="activateModel(\\'' + escapeHtml(m.id) + '\\')"`
);

// Line 1000
code = code.replace(
  `onclick="openStepModal(\\' + step.id + \\')"`,
  `onclick="openStepModal(\\'' + step.id + '\\')"`
);

// Line 1115
code = code.replace(
  `onclick="openStepModal(\\' + escapeHtml(stepIdForModal) + \\')"`,
  `onclick="openStepModal(\\'' + escapeHtml(stepIdForModal) + '\\')"`
);

// Line 1274
code = code.replace(
  `onclick="fillChatPrompt(\\'Build authentication system with OAuth2 and JWT tokens\\')"`,
  `onclick="fillChatPrompt(\\'Build authentication system with OAuth2 and JWT tokens\\')"`
);

// Line 1275
code = code.replace(
  `onclick="fillChatPrompt(\\'Create database schema and REST API endpoints\\')"`,
  `onclick="fillChatPrompt(\\'Create database schema and REST API endpoints\\')"`
);

// Line 1276
code = code.replace(
  `onclick="fillChatPrompt(\\'Audit codebase for vulnerabilities and write unit tests\\')"`,
  `onclick="fillChatPrompt(\\'Audit codebase for vulnerabilities and write unit tests\\')"`
);

// Line 1431
code = code.replace(
  `onclick="selectModel(\\' + escapeHtml(m.id) + \\')"`,
  `onclick="selectModel(\\'' + escapeHtml(m.id) + '\\')"`
);

fs.writeFileSync(appJsPath, code, 'utf8');

try {
  execSync('node -c ui-dev/app.js', { cwd: rootDir, stdio: 'pipe' });
  console.log('🎉🎉🎉 SUCCESS: ui-dev/app.js IS 100% SYNTAX VALID!');
} catch (err) {
  console.error('❌ Error:\n' + err.stderr.toString());
}
