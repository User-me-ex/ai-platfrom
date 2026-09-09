# 9 Router Models

Pick AI models served by the local **9 Router gateway** and chat with them — streaming replies and agentic file creation.

## Features

- **Model Picker** — browse live router models merged with a curated catalog of 800+ models, showing capabilities (context window, max output, vision/audio/tools flags)
- **Streaming Chat** — type messages into the input box, watch replies stream in real time
- **Agent Tools** — the model can read files, list directories, run shell commands, execute VS Code commands, and create/edit files
- **Status Bar** — one-click access to chat and model switching

## Requirements

- VS Code `^1.90.0`
- A running 9 Router gateway (default: `http://127.0.0.1:20128/v1`)

## Configuration

| Setting | Default | Description |
|---------|---------|-------------|
| `antigravity.router.baseUrl` | `http://127.0.0.1:20128/v1` | 9 Router base URL (OpenAI-compatible) |
| `antigravity.router.apiKey` | *(empty)* | Optional API key. Leave empty if auth is disabled. |

## Usage

1. Click the **9 Router** status bar item (or run `9 Router: Pick Model` from the command palette)
2. Pick a model from the list
3. Choose **Chat with selected model**
4. Type messages — the model can use agent tools automatically

## Agent Tools

The model can emit these tool blocks while chatting:

| Tool | Syntax | Description |
|------|--------|-------------|
| Read | `<antigravity:read path="..."/>` | Read a file |
| List | `<antigravity:list path="..."/>` | List a directory |
| Shell | `<antigravity:shell command="..."/>` | Run a shell command (PowerShell-friendly) |
| Search | `<antigravity:search pattern="..." path="..."/>` | Search file contents (regex, case-insensitive); `path` optional, defaults to workspace root |
| Open | `<antigravity:open path="..."/>` | Open a file in the VS Code editor |
| VS Code | `<antigravity:vscode command="..." args='[...]'/>` | Run a VS Code command |
| File | `<antigravity:file path="...">content