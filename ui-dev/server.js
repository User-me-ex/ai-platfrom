const http = require('http');
const fs = require('fs');
const path = require('path');
const { syncUiToExtension } = require('./sync-to-extension');

const PORT = 8888;
const HOST = '127.0.0.1';
const UI_DIR = __dirname;

// Load initial state
const defaultState = JSON.parse(fs.readFileSync(path.join(UI_DIR, 'mock-state.json'), 'utf8'));
let currentState = JSON.parse(JSON.stringify(defaultState));

// Clients subscribed to live-reload SSE
const reloadClients = new Set();
// Clients subscribed to message-stream SSE
const streamClients = new Set();

function broadcastReload() {
  for (const res of reloadClients) {
    try {
      res.write('data: reload\n\n');
    } catch {}
  }
}

function broadcastStreamEvent(evt) {
  const payload = 'data: ' + JSON.stringify(evt) + '\n\n';
  for (const res of streamClients) {
    try {
      res.write(payload);
    } catch {}
  }
}

// Watch UI files with debounce
let debounceTimer = null;
const watchedFiles = new Set(['index.html', 'style.css', 'app.js', 'mock-state.json']);

fs.watch(UI_DIR, (eventType, filename) => {
  if (filename && watchedFiles.has(filename)) {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      console.log(`[Watcher] Detected change in ${filename} -> Broadcasting reload`);
      broadcastReload();
    }, 150);
  }
});

// Check if 9 Router gateway is running
async function isRouterOnline() {
  try {
    const res = await fetch('http://127.0.0.1:20128/v1/models', { signal: AbortSignal.timeout(1000) });
    return res.ok;
  } catch {
    return false;
  }
}

// Handler for mock VS Code API messages
async function handleVsCodeMessage(msg) {
  const events = [];

  switch (msg.command) {
    case 'ready':
      events.push({
        type: 'updateState',
        ...currentState
      });
      break;

    case 'refresh':
      events.push({
        type: 'updateState',
        ...currentState
      });
      break;

    case 'pickModel':
      currentState.selectedModel = msg.modelId || 'ag/gemini-pro-agent';
      events.push({
        type: 'updateState',
        ...currentState
      });
      break;

    case 'selectModelForRole':
      if (currentState.roles) {
        const r = currentState.roles.find(role => role.id === msg.roleId);
        if (r) {
          r.primaryModel = msg.modelId;
        }
      }
      events.push({
        type: 'updateState',
        ...currentState
      });
      break;

    case 'switchTab':
      events.push({
        type: 'switchTab',
        tab: msg.tab
      });
      break;

    case 'voice.talk':
      currentState.voiceActive = !currentState.voiceActive;
      currentState.voiceTalking = currentState.voiceActive;
      events.push({
        type: 'updateState',
        ...currentState
      });
      break;

    case 'voice.mute':
      currentState.voiceMuted = !currentState.voiceMuted;
      events.push({
        type: 'updateState',
        ...currentState
      });
      break;

    case 'startTask': {
      const goal = msg.goal || 'Custom Task';
      currentState.workflow = {
        id: 'wf-' + Date.now(),
        userGoal: goal,
        status: 'Running',
        activeStepIndex: 0,
        steps: [
          {
            id: 's-1',
            roleId: 'researcher',
            roleName: 'Researcher',
            assignedModel: 'gemini-2.5-pro',
            status: 'Running',
            systemPrompt: 'Investigate codebase and plan architecture.',
            taskPrompt: goal,
            progressState: 'Analyzing',
            progressPercent: 30,
            progressNote: 'Scanning workspace files...'
          },
          {
            id: 's-2',
            roleId: 'backend',
            roleName: 'Backend Developer',
            assignedModel: currentState.selectedModel || 'ag/gemini-pro-agent',
            status: 'Queued',
            systemPrompt: 'Implement logic and APIs.',
            taskPrompt: 'Implement features planned by Researcher',
            progressState: 'Planning',
            progressPercent: 0,
            progressNote: 'Waiting for step 1'
          },
          {
            id: 's-3',
            roleId: 'testing',
            roleName: 'QA & Testing Engineer',
            assignedModel: 'qwen3.7-plus',
            status: 'Queued',
            systemPrompt: 'Run verification tests.',
            taskPrompt: 'Verify implementation',
            progressState: 'Planning',
            progressPercent: 0,
            progressNote: 'Queued'
          }
        ],
        fallbacks: []
      };
      events.push({
        type: 'updateState',
        ...currentState
      });
      break;
    }

    case 'pause':
      if (currentState.workflow) {
        currentState.workflow.status = 'Paused';
        events.push({
          type: 'updateState',
          ...currentState
        });
      }
      break;

    case 'resume':
      if (currentState.workflow) {
        currentState.workflow.status = 'Running';
        events.push({
          type: 'updateState',
          ...currentState
        });
      }
      break;

    case 'cancel':
      if (currentState.workflow) {
        currentState.workflow.status = 'Cancelled';
        events.push({
          type: 'updateState',
          ...currentState
        });
      }
      break;

    case 'chat': {
      const userText = msg.text || '';
      const userMsgId = 'msg-' + Date.now();
      const aiMsgId = 'ai-' + (Date.now() + 1);

      // Append user message
      const userMsg = {
        id: userMsgId,
        sender: 'user',
        content: userText,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      };
      currentState.chatMessages.push(userMsg);
      events.push({ type: 'chatMessage', message: userMsg });

      // Simulate streaming AI reply from ag/gemini-pro-agent
      const aiMsg = {
        id: aiMsgId,
        sender: 'ai',
        roleName: 'Main AI',
        roleModel: currentState.selectedModel || 'ag/gemini-pro-agent',
        content: '',
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      };
      currentState.chatMessages.push(aiMsg);
      events.push({ type: 'chatMessage', message: aiMsg });

      // Asynchronously stream reply tokens
      setTimeout(async () => {
        const fullReply = `I received your prompt: **"${userText}"**\n\n` +
          `Running with model **${currentState.selectedModel || 'ag/gemini-pro-agent'}** on \`http://localhost:8888\`.\n\n` +
          `### Capabilities & System Status:\n` +
          `- **UI Live-Editing**: Changes in \`style.css\`, \`index.html\`, or \`app.js\` hot-reload instantly.\n` +
          `- **Extension Sync**: Press **🔄 Sync to Extension** in the top bar to apply your UI edits to \`src/ui/workflowWebview.ts\`.\n` +
          `- **Orchestrator**: 13 specialized roles, serial pipeline graph, and fuzzy model picker are fully active.\n\n` +
          `\`\`\`json\n` +
          `{\n` +
          `  "activeModel": "${currentState.selectedModel || 'ag/gemini-pro-agent'}",\n` +
          `  "status": "ready",\n` +
          `  "port": 8888\n` +
          `}\n` +
          `\`\`\``;

        const words = fullReply.split(' ');
        for (let i = 0; i < words.length; i++) {
          await new Promise(r => setTimeout(r, 35));
          broadcastStreamEvent({
            type: 'chatDelta',
            id: aiMsgId,
            text: (i === 0 ? '' : ' ') + words[i]
          });
        }
      }, 100);
      break;
    }

    default:
      events.push({ type: 'ack', command: msg.command });
      break;
  }

  return events;
}

// HTTP Server
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${HOST}:${PORT}`);

  // SSE: Live reload
  if (url.pathname === '/api/live-reload') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive'
    });
    reloadClients.add(res);
    req.on('close', () => reloadClients.delete(res));
    return;
  }

  // SSE: Message streaming
  if (url.pathname === '/api/stream-events') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive'
    });
    streamClients.add(res);
    req.on('close', () => streamClients.delete(res));
    return;
  }

  // API: VS Code message bridge
  if (url.pathname === '/api/vscode-message' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', async () => {
      try {
        const msg = JSON.parse(body);
        const events = await handleVsCodeMessage(msg);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, events }));
      } catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: err.message }));
      }
    });
    return;
  }

  // API: Reset mock state
  if (url.pathname === '/api/reset-state' && req.method === 'POST') {
    currentState = JSON.parse(JSON.stringify(defaultState));
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true }));
    return;
  }

  // API: Sync back to src/ui/workflowWebview.ts
  if (url.pathname === '/api/sync' && req.method === 'POST') {
    try {
      const result = syncUiToExtension(false);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(result));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: false, error: err.message }));
    }
    return;
  }

  // API: Status
  if (url.pathname === '/api/status') {
    const routerOk = await isRouterOnline();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      selectedModel: currentState.selectedModel,
      routerOnline: routerOk,
      port: PORT
    }));
    return;
  }

  // Static file serving
  let filePath = path.join(UI_DIR, url.pathname === '/' ? 'index.html' : url.pathname);

  // Security check: ensure path is within UI_DIR
  if (!filePath.startsWith(UI_DIR)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
    const ext = path.extname(filePath);
    const mimeTypes = {
      '.html': 'text/html; charset=utf-8',
      '.css': 'text/css; charset=utf-8',
      '.js': 'text/javascript; charset=utf-8',
      '.json': 'application/json; charset=utf-8',
      '.png': 'image/png',
      '.svg': 'image/svg+xml'
    };
    res.writeHead(200, { 'Content-Type': mimeTypes[ext] || 'text/plain' });
    fs.createReadStream(filePath).pipe(res);
  } else {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not Found');
  }
});

server.listen(PORT, HOST, () => {
  console.log(`\n======================================================`);
  console.log(`🚀 9 Router UI Dev Server running at:`);
  console.log(`👉 http://${HOST}:${PORT}`);
  console.log(`👉 Selected Model: ${currentState.selectedModel}`);
  console.log(`💡 Live Reload: Watching index.html, style.css, app.js`);
  console.log(`🔄 Sync Script: node ui-dev/sync-to-extension.js`);
  console.log(`======================================================\n`);
});
