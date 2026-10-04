const fs = require('fs');
const path = require('path');

const srcRoot = __dirname;
const userHome = process.env.USERPROFILE || 'C:/Users/USER';

const targetDirs = [
  path.join(userHome, '.antigravity-ide/extensions/antigravity-dev.antigravity-models-0.5.20'),
  path.join(userHome, '.antigravity/extensions/antigravity-dev.antigravity-models-0.5.20'),
  path.join(userHome, '.vscode/extensions/antigravity-dev.antigravity-models-0.5.20')
];

function copyRecursive(src, dst) {
  if (!fs.existsSync(src)) return;
  const stat = fs.statSync(src);
  if (stat.isDirectory()) {
    if (!fs.existsSync(dst)) fs.mkdirSync(dst, { recursive: true });
    for (const file of fs.readdirSync(src)) {
      copyRecursive(path.join(src, file), path.join(dst, file));
    }
  } else {
    fs.copyFileSync(src, dst);
  }
}

for (const dstRoot of targetDirs) {
  if (fs.existsSync(dstRoot)) {
    console.log(`[deploy] Syncing build to ${dstRoot}...`);
    copyRecursive(path.join(srcRoot, 'out'), path.join(dstRoot, 'out'));
    fs.copyFileSync(path.join(srcRoot, 'package.json'), path.join(dstRoot, 'package.json'));
    console.log(`[deploy] Done syncing to ${path.basename(path.dirname(dstRoot))}!`);
  }
}
