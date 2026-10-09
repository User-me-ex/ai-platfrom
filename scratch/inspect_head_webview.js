const { execSync } = require('child_process');
const fs = require('fs');

const headContent = execSync('git show HEAD:src/ui/workflowWebview.ts', { maxBuffer: 10 * 1024 * 1024 }).toString('utf8');
const lines = headContent.split('\n');

let styleStart = -1, styleEnd = -1, scriptStart = -1, scriptEnd = -1;
for (let i = 0; i < lines.length; i++) {
  if (lines[i].includes('<style>') && styleStart === -1) styleStart = i + 1;
  if (lines[i].includes('</style>') && styleEnd === -1) styleEnd = i;
  if (lines[i].includes('<script nonce="${nonce}">') && scriptStart === -1) scriptStart = i + 1;
  if (lines[i].includes('</script>') && i > 4000) scriptEnd = i;
}

console.log({
  totalLines: lines.length,
  styleStart,
  styleEnd,
  scriptStart,
  scriptEnd
});
