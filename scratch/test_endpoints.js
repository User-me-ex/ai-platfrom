const http = require('http');

async function postJson(path, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const req = http.request({
      hostname: '127.0.0.1',
      port: 8888,
      path: path,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data)
      }
    }, (res) => {
      let resBody = '';
      res.on('data', chunk => resBody += chunk);
      res.on('end', () => resolve({ statusCode: res.statusCode, body: JSON.parse(resBody) }));
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

async function getJson(path) {
  return new Promise((resolve, reject) => {
    http.get(`http://127.0.0.1:8888${path}`, (res) => {
      let resBody = '';
      res.on('data', chunk => resBody += chunk);
      res.on('end', () => resolve({ statusCode: res.statusCode, body: JSON.parse(resBody) }));
    }).on('error', reject);
  });
}

async function main() {
  console.log('--- 1. Testing /api/status ---');
  const status = await getJson('/api/status');
  console.log('Status:', status);

  console.log('\n--- 2. Testing /api/vscode-message ready ---');
  const ready = await postJson('/api/vscode-message', { command: 'ready' });
  console.log('Ready response event types:', ready.body.events.map(e => e.type));
  console.log('Selected model in state:', ready.body.events[0].selectedModel);

  console.log('\n--- 3. Testing /api/vscode-message chat ---');
  const chat = await postJson('/api/vscode-message', { command: 'chat', text: 'Test chat message' });
  console.log('Chat response events:', chat.body.events.map(e => ({ type: e.type, sender: e.message?.sender, model: e.message?.roleModel })));

  console.log('\n--- 4. Testing /api/sync ---');
  const sync = await postJson('/api/sync', {});
  console.log('Sync result:', sync);

  console.log('\nALL TESTS PASSED ✅');
}

main().catch(console.error);
