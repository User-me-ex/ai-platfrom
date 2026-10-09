const fs = require('fs');
const path = require('path');

// 1. Clean ui-dev/index.html
const indexHtmlPath = path.join(__dirname, '..', 'ui-dev', 'index.html');
let indexHtml = fs.readFileSync(indexHtmlPath, 'utf8');

// Ensure tabs bar is completely removed
indexHtml = indexHtml.replace(
  /\r?\n\s*<button class="tab-btn\s*" id="tabWorkflowBtn"[\s\S]*?<\/div>/,
  ''
);

// Ensure #qaGrid is display: none by default
indexHtml = indexHtml.replace(
  /<div class="qa-grid" id="qaGrid" style="[^"]*">/,
  '<div class="qa-grid" id="qaGrid" style="display: none;">'
);

fs.writeFileSync(indexHtmlPath, indexHtml, 'utf8');
console.log('ui-dev/index.html updated successfully.');
