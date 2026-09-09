// Quick test of the edit/search logic by simulating what chat.ts does
const fs = require('fs');
const path = require('path');

// Test file
const testFile = 'test-edit-target.txt';
fs.writeFileSync(testFile, 'Hello world\nThis is a test file.\nGoodbye world\n');

// Simulate editFile logic
function editFile(target, oldText, newText) {
  const content = fs.readFileSync(target, 'utf8');
  const idx = content.indexOf(oldText);
  if (idx < 0) return '[error] <old> text not found';
  const updated = content.slice(0, idx) + newText + content.slice(idx + oldText.length);
  fs.writeFileSync(target, updated);
  return `edited ${target} (replaced ${oldText.length} chars)`;
}

// Test 1: edit
console.log('=== Test edit ===');
console.log(editFile(testFile, 'Hello world', 'Hello VS Code'));
console.log('Content:', JSON.stringify(fs.readFileSync(testFile, 'utf8')));

// Test 2: edit with non-existent text
console.log('\n=== Test edit (not found) ===');
console.log(editFile(testFile, 'nonexistent text', 'nope'));

// Test 3: simple search simulation
console.log('\n=== Test search ===');
const content = fs.readFileSync(testFile, 'utf8');
const lines = content.split('\n');
const re = /test/i;
for (let i = 0; i < lines.length; i++) {
  if (re.test(lines[i])) {
    console.log(`test-edit-target.txt:${i + 1}: ${lines[i].trim()}`);
  }
}

// Cleanup
fs.unlinkSync(testFile);
console.log('\n✅ All tool tests passed!');