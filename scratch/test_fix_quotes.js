const fs = require('fs');
const path = require('path');

const appJsPath = path.join(__dirname, '..', 'ui-dev', 'app.js');
let content = fs.readFileSync(appJsPath, 'utf8');

// Replace the double-escaped quotes that originated from template string in TS
// e.g. \\' -> \'  and \\\\' -> \'
content = content.replace(/\\\\'/g, "'");
content = content.replace(/\\'/g, "'");

// But wait! If it's inside single-quoted strings:
// e.g. onclick="openStepModal(' + step.id + ')"
// We can use double quotes for outer strings or replace with proper escaping:
// E.g. onclick="openStepModal(\'' -> onclick="openStepModal(\'' (single backslash before quote)
// Let's use clean escaping or template strings.
