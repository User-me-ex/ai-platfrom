const fs = require('fs');
const path = require('path');

const appJsPath = path.join(__dirname, '..', 'ui-dev', 'app.js');
const lines = fs.readFileSync(appJsPath, 'utf8').split('\n');

lines.forEach((line, idx) => {
  if (line.includes('onclick=') || line.includes('onchange=')) {
    console.log(`Line ${idx + 1}: ${line.trim()}`);
  }
});
