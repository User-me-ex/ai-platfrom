const fs = require('fs');
const lines = fs.readFileSync('src/ui/workflowWebview.ts', 'utf8').split('\n');

let styleStart = -1, styleEnd = -1, scriptStart = -1, scriptEnd = -1;

for (let i = 0; i < lines.length; i++) {
  const line = lines[i];
  if (line.includes('<style>') && styleStart === -1) {
    styleStart = i;
  }
  if (line.includes('</style>') && styleEnd === -1) {
    styleEnd = i;
  }
  if (line.includes('<script nonce="${nonce}">') && scriptStart === -1) {
    scriptStart = i;
  }
  if (line.includes('</script>') && i > 4000) {
    scriptEnd = i;
  }
}

console.log(JSON.stringify({
  styleStart: styleStart + 1,
  styleEnd: styleEnd + 1,
  scriptStart: scriptStart + 1,
  scriptEnd: scriptEnd + 1,
  totalLines: lines.length
}, null, 2));
