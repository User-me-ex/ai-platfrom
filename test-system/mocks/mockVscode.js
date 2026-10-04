'use strict';

const Module = require('module');
const fs = require('fs');
const path = require('path');
const { EventEmitter } = require('events');

function createMockVscode(envManager, config = {}) {
  const commandRegistry = new Map();
  const globalStore = new Map();
  const workspaceStore = new Map();
  const outputChannels = new Map();
  const eventEmitter = new EventEmitter();

  const workspaceRoot = envManager.workspaceDir;

  const mockVscode = {
    Uri: {
      file: (fsPath) => ({
        fsPath: path.resolve(fsPath),
        path: fsPath.replace(/\\/g, '/'),
        scheme: 'file',
        toString: () => `file:///${fsPath.replace(/\\/g, '/')}`
      }),
      joinPath: (baseUri, ...segments) => {
        const full = path.join(baseUri.fsPath, ...segments);
        return mockVscode.Uri.file(full);
      }
    },

    StatusBarAlignment: {
      Left: 1,
      Right: 2
    },

    ViewColumn: {
      Active: -1,
      Beside: -2,
      One: 1,
      Two: 2,
      Three: 3
    },

    ConfigurationTarget: {
      Global: 1,
      Workspace: 2,
      WorkspaceFolder: 3
    },

    workspace: {
      workspaceFolders: [
        {
          uri: {
            fsPath: workspaceRoot,
            scheme: 'file',
            toString: () => `file:///${workspaceRoot.replace(/\\/g, '/')}`
          },
          name: path.basename(workspaceRoot),
          index: 0
        }
      ],

      getConfiguration: (section) => {
        let loadedSettings = {};
        if (fs.existsSync(envManager.settingsJsonPath)) {
          try {
            loadedSettings = JSON.parse(fs.readFileSync(envManager.settingsJsonPath, 'utf8'));
          } catch {}
        }

        return {
          get: (key, defaultValue) => {
            const fullKey = section ? `${section}.${key}` : key;
            if (fullKey in loadedSettings) return loadedSettings[fullKey];
            if (key in loadedSettings) return loadedSettings[key];
            return defaultValue;
          },
          update: async (key, value) => {
            const fullKey = section ? `${section}.${key}` : key;
            loadedSettings[fullKey] = value;
            fs.writeFileSync(envManager.settingsJsonPath, JSON.stringify(loadedSettings, null, 2), 'utf8');
          }
        };
      },

      openTextDocument: async (uriOrPath) => {
        const p = uriOrPath.fsPath || uriOrPath;
        const text = fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : '';
        return {
          uri: mockVscode.Uri.file(p),
          getText: () => text,
          fileName: p,
          lineCount: text.split('\n').length
        };
      },

      createFileSystemWatcher: (pattern) => {
        const watcherEmitter = new EventEmitter();
        return {
          onDidChange: (listener) => {
            watcherEmitter.on('change', listener);
            return { dispose: () => watcherEmitter.off('change', listener) };
          },
          onDidCreate: (listener) => {
            watcherEmitter.on('create', listener);
            return { dispose: () => watcherEmitter.off('create', listener) };
          },
          onDidDelete: (listener) => {
            watcherEmitter.on('delete', listener);
            return { dispose: () => watcherEmitter.off('delete', listener) };
          },
          dispose: () => watcherEmitter.removeAllListeners(),
          _emitChange: (uri) => watcherEmitter.emit('change', uri)
        };
      },

      fs: {
        createDirectory: async (uri) => {
          fs.mkdirSync(uri.fsPath, { recursive: true });
        },
        writeFile: async (uri, content) => {
          fs.writeFileSync(uri.fsPath, Buffer.from(content));
        },
        readFile: async (uri) => {
          return fs.readFileSync(uri.fsPath);
        },
        readDirectory: async (uri) => {
          if (!fs.existsSync(uri.fsPath)) return [];
          return fs.readdirSync(uri.fsPath).map((n) => {
            const isDir = fs.statSync(path.join(uri.fsPath, n)).isDirectory();
            return [n, isDir ? 2 : 1];
          });
        }
      }
    },

    window: {
      showInformationMessage: async (msg, ...items) => {
        eventEmitter.emit('infoMessage', msg);
        return items[0];
      },
      showWarningMessage: async (msg, ...items) => {
        eventEmitter.emit('warnMessage', msg);
        return typeof items[0] === 'string' ? items[0] : (items[1] || items[0]);
      },
      showErrorMessage: async (msg, ...items) => {
        eventEmitter.emit('errorMessage', msg);
        return items[0];
      },
      showQuickPick: async (items) => {
        return Array.isArray(items) ? items[0] : null;
      },
      showInputBox: async (options) => {
        return options?.value || 'Test Goal Input';
      },
      showTextDocument: async (doc) => {
        return { document: doc };
      },

      createOutputChannel: (name) => {
        const lines = [];
        const ch = {
          name,
          lines,
          append: (val) => {
            if (lines.length === 0) lines.push('');
            lines[lines.length - 1] += val;
          },
          appendLine: (val) => {
            lines.push(val);
          },
          show: () => {},
          clear: () => { lines.length = 0; },
          dispose: () => {}
        };
        outputChannels.set(name, ch);
        return ch;
      },

      createStatusBarItem: (alignment, priority) => {
        const item = {
          alignment,
          priority,
          text: '',
          tooltip: '',
          command: '',
          visible: false,
          show: () => { item.visible = true; },
          hide: () => { item.visible = false; },
          dispose: () => { item.visible = false; }
        };
        return item;
      },

      createWebviewPanel: (viewType, title, showOptions, options) => {
        const messageListeners = [];
        const panel = {
          viewType,
          title,
          active: true,
          visible: true,
          viewColumn: showOptions,
          options,
          webview: {
            html: '',
            options: options || {},
            asWebviewUri: (uri) => uri,
            cspSource: '*',
            postMessage: async (msg) => {
              for (const listener of messageListeners) {
                listener(msg);
              }
              return true;
            },
            onDidReceiveMessage: (listener) => {
              messageListeners.push(listener);
              return {
                dispose: () => {
                  const idx = messageListeners.indexOf(listener);
                  if (idx !== -1) messageListeners.splice(idx, 1);
                }
              };
            },
            _dispatchMessage: async (msg) => {
              for (const listener of messageListeners) {
                listener(msg);
              }
            }
          },
          onDidDispose: (cb) => ({ dispose: () => {} }),
          reveal: () => { panel.visible = true; },
          dispose: () => { panel.visible = false; }
        };
        return panel;
      }
    },

    commands: {
      registerCommand: (id, callback) => {
        commandRegistry.set(id, callback);
        return {
          dispose: () => {
            commandRegistry.delete(id);
          }
        };
      },
      executeCommand: async (id, ...args) => {
        if (!commandRegistry.has(id)) {
          throw new Error(`Command not found: ${id}`);
        }
        const fn = commandRegistry.get(id);
        return await fn(...args);
      },
      getCommands: async (filterInternal = false) => {
        return Array.from(commandRegistry.keys());
      }
    }
  };

  const mockContext = {
    globalState: {
      get: (key, defaultValue) => globalStore.has(key) ? globalStore.get(key) : defaultValue,
      update: async (key, val) => { globalStore.set(key, val); }
    },
    workspaceState: {
      get: (key, defaultValue) => workspaceStore.has(key) ? workspaceStore.get(key) : defaultValue,
      update: async (key, val) => { workspaceStore.set(key, val); }
    },
    extensionUri: mockVscode.Uri.file(process.cwd()),
    extensionPath: process.cwd(),
    subscriptions: [],
    asAbsolutePath: (relPath) => path.join(process.cwd(), relPath)
  };

  return {
    vscode: mockVscode,
    context: mockContext,
    commandRegistry,
    outputChannels,
    eventEmitter
  };
}

let installed = false;
let currentMock = null;

function installMockVscode(envManager, config = {}) {
  currentMock = createMockVscode(envManager, config);

  if (!installed) {
    const origLoad = Module._load;
    Module._load = function (request, parent, isMain) {
      if (request === 'vscode') {
        return currentMock.vscode;
      }
      return origLoad.apply(this, arguments);
    };
    installed = true;
  }

  return currentMock;
}

module.exports = {
  createMockVscode,
  installMockVscode
};
