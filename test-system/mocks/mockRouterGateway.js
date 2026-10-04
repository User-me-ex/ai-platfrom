'use strict';

const http = require('http');

class MockRouterGateway {
  constructor(port = 20129, logCollector = null) {
    this.port = port;
    this.logCollector = logCollector;
    this.server = null;
    this.requests = [];
    this.faults = {
      model500: null, // if set to a model name, returns HTTP 500 for that model
      networkError: false,
      delayMs: 0
    };
  }

  setFault(options) {
    this.faults = { ...this.faults, ...options };
  }

  clearFaults() {
    this.faults = {
      model500: null,
      networkError: false,
      delayMs: 0
    };
  }

  async start() {
    return new Promise((resolve, reject) => {
      this.server = http.createServer(async (req, res) => {
        let body = '';
        req.on('data', (chunk) => { body += chunk; });
        req.on('end', () => {
          let parsedBody = null;
          try {
            if (body) parsedBody = JSON.parse(body);
          } catch {}

          const record = {
            method: req.method,
            url: req.url,
            headers: req.headers,
            body: parsedBody,
            timestamp: new Date().toISOString()
          };
          this.requests.push(record);

          if (this.logCollector) {
            this.logCollector.info('MockRouterGateway', `${req.method} ${req.url}`);
          }

          // Fault: Network error simulation
          if (this.faults.networkError) {
            res.destroy();
            return;
          }

          // Delay simulation
          const sendResponse = () => {
            // 1. GET /v1/models
            if (req.method === 'GET' && req.url.startsWith('/v1/models')) {
              res.writeHead(200, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({
                data: [
                  { id: 'ag/gemini-3.8-flash-high', object: 'model' },
                  { id: 'ag/gemini-2.5-flash-native-audio-latest', object: 'model' },
                  { id: 'ag/gemini-3.1-flash-live-preview', object: 'model' }
                ]
              }));
              return;
            }

            // 2. POST /v1/chat/completions
            if (req.method === 'POST' && req.url.startsWith('/v1/chat/completions')) {
              const requestedModel = parsedBody?.model || '';

              // Check if 500 fault configured for this model
              if (this.faults.model500 && requestedModel.includes(this.faults.model500)) {
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({
                  error: {
                    message: `Internal server error for model ${requestedModel}`,
                    type: 'server_error',
                    code: 500
                  }
                }));
                return;
              }

              // Handle streaming vs non-streaming
              const isStream = parsedBody?.stream === true;
              if (isStream) {
                res.writeHead(200, {
                  'Content-Type': 'text/event-stream',
                  'Cache-Control': 'no-cache',
                  'Connection': 'keep-alive'
                });

                const chunks = [
                  'Hello! ',
                  'I am the 9 Router ',
                  'AI assistant. Everything is working correctly.'
                ];

                for (let i = 0; i < chunks.length; i++) {
                  const sseData = {
                    id: `chatcmpl-${Date.now()}-${i}`,
                    object: 'chat.completion.chunk',
                    created: Math.floor(Date.now() / 1000),
                    model: requestedModel,
                    choices: [
                      {
                        index: 0,
                        delta: { content: chunks[i] },
                        finish_reason: i === chunks.length - 1 ? 'stop' : null
                      }
                    ]
                  };
                  res.write(`data: ${JSON.stringify(sseData)}\n\n`);
                }
                res.write('data: [DONE]\n\n');
                res.end();
              } else {
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({
                  id: `chatcmpl-${Date.now()}`,
                  object: 'chat.completion',
                  created: Math.floor(Date.now() / 1000),
                  model: requestedModel,
                  choices: [
                    {
                      index: 0,
                      message: {
                        role: 'assistant',
                        content: 'Task completed successfully by mock gateway.'
                      },
                      finish_reason: 'stop'
                    }
                  ]
                }));
              }
              return;
            }

            // Fallback 404
            res.writeHead(404, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Endpoint not found in mock gateway' }));
          };

          if (this.faults.delayMs > 0) {
            setTimeout(sendResponse, this.faults.delayMs);
          } else {
            sendResponse();
          }
        });
      });

      this.server.on('error', (err) => {
        if (this.logCollector) {
          this.logCollector.error('MockRouterGateway', `Server error: ${err.message}`);
        }
        reject(err);
      });

      this.server.listen(this.port, '127.0.0.1', () => {
        if (this.logCollector) {
          this.logCollector.info('MockRouterGateway', `Mock gateway listening on http://127.0.0.1:${this.port}`);
        }
        resolve();
      });
    });
  }

  async stop() {
    if (!this.server) return;
    return new Promise((resolve) => {
      this.server.close(() => {
        this.server = null;
        resolve();
      });
    });
  }
}

module.exports = { MockRouterGateway };
