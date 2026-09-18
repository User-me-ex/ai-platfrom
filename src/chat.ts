import * as vscode from 'vscode';
import * as childProcess from 'child_process';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';

export interface ChatRequest {
  baseUrl: string;
  apiKey?: string;
  model: string;
  messages: ChatMessage[];
  temperature?: number;
  maxTokens?: number;
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

interface Delta {
  content?: string;
}

const FILE_BLOCK_RE = /<antigravity:file\s+path=["']([^"']+)["']>([\s\S]*?)<\/antigravity:file>/gi;
const EDIT_BLOCK_RE = /<antigravity:edit\s+path=["']([^"']+)["']>\s*<<<<\r?\n([\s\S]*?)\r?\n====\r?\n([\s\S]*?)\r?\n>>>>\s*<\/antigravity:edit>/gi;
const READ_BLOCK_RE = /<antigravity:read\s+path=["']([^"']+)["']\s*(?:start=["'](\d+)["']\s*)?(?:end=["'](\d+)["']\s*)?\/>/gi;
const LIST_BLOCK_RE = /<antigravity:list\s+path=["']([^"']*)["']\s*\/>/gi;
const SHELL_BLOCK_RE = /<antigravity:shell\s+command=["']([^"']*)["']\s*\/>/gi;
const OPEN_BLOCK_RE = /<antigravity:open\s+path=["']([^"']+)["']\s*\/>/gi;
const VSCODE_BLOCK_RE = /<antigravity:vscode\b([^>]*?)\/>/gi;
const TOOL_BLOCK_OPEN = '<antigravity';

// Voice-friendly tool patterns
const VOICE_READ_RE = /(?:^|\n)\s*(?:\*\*)?TOOL:\s*read\s+([^\n*]+?)(?:\s+(\d+)\s+(\d+))?\s*(?:\*\*)?(?:$|\n)/gi;
const VOICE_LIST_RE = /(?:^|\n)\s*(?:\*\*)?TOOL:\s*list\s+([^\n*]+?)\s*(?:\*\*)?(?:$|\n)/gi;
const VOICE_OPEN_RE = /(?:^|\n)\s*(?:\*\*)?TOOL:\s*open\s+([^\n*]+?)\s*(?:\*\*)?(?:$|\n)/gi;
const VOICE_SHELL_RE = /(?:^|\n)\s*(?:\*\*)?TOOL:\s*shell\s+([^\n*]+?)\s*(?:\*\*)?(?:$|\n)/gi;
const VOICE_FILE_RE = /(?:^|\n)\s*(?:\*\*)?TOOL:\s*file\s+([^\n*]+?)\s*(?:\*\*)?\r?\n([\s\S]*?)(?:^|\n)\s*(?:\*\*)?END TOOL(?:\*\*)?/gi;
const VOICE_EDIT_RE = /(?:^|\n)\s*(?:\*\*)?TOOL:\s*edit\s+([^\n*]+?)\s*(?:\*\*)?\r?\n<<<<\r?\n([\s\S]*?)\r?\n====\r?\n([\s\S]*?)\r?\n>>>>\s*(?:^|\n)\s*(?:\*\*)?END TOOL(?:\*\*)?/gi;


export const AGENT_SYSTEM = [
  'You are a coding agent running inside the user\'s VS Code (Windows), powered by the local 9 Router gateway.',
  'You have full access to the machine. Available tools:',
  '- <antigravity:file path="...">content</antigravity:file>  -> create or overwrite any file (absolute path, or relative to the workspace folder).',
  '- <antigravity:edit path="...">\\n<<<<\\nexact old text to replace\\n====\\nnew replacement text\\n>>>>\\n</antigravity:edit>  -> edit a file by replacing a specific block of text. The "old text" must perfectly match a unique sequence in the file.',
  '- <antigravity:read path="..." start="1" end="50"/>  -> read any file; its contents are returned to you (start and end lines are optional).',
  '- <antigravity:list path="..."/>  -> list any directory; entries are returned to you.',
  '- <antigravity:shell command="..."/>  -> run any shell command on this Windows machine (PowerShell-friendly commands work best: Get-ChildItem, Get-Content, type, dir).',
  '- <antigravity:vscode command="..." args=\'[json args]\'/>  -> run a VS Code command (e.g. workbench.action.openSettings, editor.action.formatDocument, or any contributed command).',
  '- <antigravity:open path="..."/>  -> open a file in the VS Code editor.',
'Tool results are returned to you automatically - use them and continue; never invent file contents you have not read.',
  'To achieve multi-step goals (list -> read -> edit -> verify), use tools and react to each result.',
  'When the user asks you to create a file, ALWAYS emit the <antigravity:file> block immediately and never just describe it or claim it was created (an empty file is valid: <antigravity:file path="file.md"></antigravity:file>). Use a relative path so it lands in the workspace folder listed above.'
].join('\n');

export function agentSystem(roots: string[]): string {
  const banner = roots.length
    ? 'Workspace folder' + (roots.length > 1 ? 's' : '') + ' (relative file paths are resolved against these):\n' +
      roots.map((r) => '  ' + r).join('\n')
    : 'No workspace folder is open — relative paths cannot be resolved. Use absolute paths for <antigravity:file>, <antigravity:read>, <antigravity:list> and <antigravity:open>.';
  return banner + '\n\n' + AGENT_SYSTEM;
}

export const VOICE_AGENT_SYSTEM = [
  'You are a voice-driven coding agent running inside the user\'s VS Code (Windows), powered by the local 9 Router gateway.',
  'You have full access to the machine. Because you are using speech-to-text, you MUST use the following simplified plain-text formats to invoke tools (do NOT use XML tags):',
  '- **TOOL: file filepath**\ncontent here\n**END TOOL**  -> create or overwrite any file (absolute path, or relative to the workspace folder).',
  '- **TOOL: edit filepath**\n<<<<\nexact old text to replace\n====\nnew replacement text\n>>>>\n**END TOOL**  -> edit a file by replacing a specific block of text. The "old text" must perfectly match a unique sequence in the file.',
  '- **TOOL: read filepath startLine endLine**  -> read any file; its contents are returned to you (startLine and endLine are optional).',
  '- **TOOL: list dirpath**  -> list any directory; entries are returned to you.',
  '- **TOOL: shell command**  -> run any shell command on this Windows machine.',
  '- **TOOL: open filepath**  -> open a file in the VS Code editor.',
  'Tool results are returned to you automatically - use them and continue; never invent file contents you have not read.',
  'To achieve multi-step goals (list -> read -> edit -> verify), use tools and react to each result.',
  'When the user asks you to create a file, ALWAYS emit the TOOL block immediately and never just describe it or claim it was created.'
].join('\n');

export function voiceAgentSystem(roots: string[]): string {
  const banner = roots.length
    ? 'Workspace folder' + (roots.length > 1 ? 's' : '') + ' (relative file paths are resolved against these):\n' +
      roots.map((r) => '  ' + r).join('\n')
    : 'No workspace folder is open — relative paths cannot be resolved. Use absolute paths.';
  return banner + '\n\n' + VOICE_AGENT_SYSTEM;
}

export interface ToolResult {
  tool: string;
  args: string;
  output: string;
}

export interface ToolPolicy {
  allowShell?: boolean;
  allowVscode?: boolean;
  allowFiles?: boolean;
}

function stripAll(content: string): string {
  return content
    .replace(FILE_BLOCK_RE, '')
    .replace(EDIT_BLOCK_RE, '')
    .replace(READ_BLOCK_RE, '')
    .replace(LIST_BLOCK_RE, '')
    .replace(SHELL_BLOCK_RE, '')
    .replace(OPEN_BLOCK_RE, '')
    .replace(VSCODE_BLOCK_RE, '')
    .replace(VOICE_FILE_RE, '')
    .replace(VOICE_EDIT_RE, '')
    .replace(VOICE_READ_RE, '')
    .replace(VOICE_LIST_RE, '')
    .replace(VOICE_SHELL_RE, '')
    .replace(VOICE_OPEN_RE, '')
    .replace(/^\n+|\n+$/g, '')
    .replace(/\n{2,}/g, '\n')
    .trim();
}

export function stripToolBlocks(content: string): string {
  return stripAll(content);
}

export function parseFileBlocks(content: string): Array<{ path: string; text: string }> {
  const out: Array<{ path: string; text: string }> = [];
  for (const m of content.matchAll(FILE_BLOCK_RE)) {
    out.push({ path: m[1].trim(), text: m[2].replace(/^\r?\n|\r?\n$/g, '') });
  }
  for (const m of content.matchAll(VOICE_FILE_RE)) {
    out.push({ path: m[1].trim(), text: m[2].replace(/^\r?\n|\r?\n$/g, '') });
  }
  return out;
}

export function hasToolBlocks(content: string): boolean {
  return content.includes(TOOL_BLOCK_OPEN) || /TOOL:\s*(read|list|open|shell|file|edit)/i.test(content);
}

export async function executeTools(content: string, roots: string[], policy?: ToolPolicy): Promise<ToolResult[]> {
  const results: ToolResult[] = [];
  const shellCwd = roots[0] ?? os.homedir();
  const toolEnabled = (tool: string): boolean => {
    if (!policy) return true;
    if (tool === 'shell') return policy.allowShell !== false;
    if (tool === 'vscode') return policy.allowVscode !== false;
    if (tool === 'files') return policy.allowFiles !== false;
    return true;
  };

  if (toolEnabled('shell')) {
    for (const m of content.matchAll(SHELL_BLOCK_RE)) {
      const command = m[1].trim();
      if (!command) continue;
      results.push({ tool: 'shell', args: command, output: await runShell(command, shellCwd) });
    }
    for (const m of content.matchAll(VOICE_SHELL_RE)) {
      const command = m[1].trim();
      if (!command) continue;
      results.push({ tool: 'shell', args: command, output: await runShell(command, shellCwd) });
    }
  }

  if (toolEnabled('files')) {
    const readMatches = [...content.matchAll(READ_BLOCK_RE), ...content.matchAll(VOICE_READ_RE)];
    for (const m of readMatches) {
      const p = resolvePath(m[1].trim(), roots);
      if (!p) {
        results.push({ tool: 'read', args: m[1].trim(), output: '[error] path could not be resolved' });
        continue;
      }
      try {
        const textBytes = await vscode.workspace.fs.readFile(vscode.Uri.file(p));
        let text = Buffer.from(textBytes).toString('utf8');
        const start = m[2] ? parseInt(m[2], 10) : undefined;
        const end = m[3] ? parseInt(m[3], 10) : undefined;
        
        if (start !== undefined || end !== undefined) {
          const lines = text.split(/\r?\n/);
          const startIdx = start !== undefined ? Math.max(0, start - 1) : 0;
          const endIdx = end !== undefined ? Math.min(lines.length, end) : lines.length;
          text = lines.slice(startIdx, endIdx).join('\n');
        }

        results.push({ tool: 'read', args: m[1].trim(), output: text });
      } catch (err) {
        results.push({ tool: 'read', args: m[1].trim(), output: `[error] ${err instanceof Error ? err.message : String(err)}` });
      }
    }

    const listMatches = [...content.matchAll(LIST_BLOCK_RE), ...content.matchAll(VOICE_LIST_RE)];
    for (const m of listMatches) {
      const p = resolvePath(m[1].trim(), roots);
      if (!p) {
        results.push({ tool: 'list', args: m[1].trim(), output: '[error] path could not be resolved' });
        continue;
      }
      try {
        const entries = await vscode.workspace.fs.readDirectory(vscode.Uri.file(p));
        const lines = entries
          .sort((a, b) => a[0].localeCompare(b[0]))
          .map(([name, type]) => `${type === 2 ? 'dir ' : 'file'} ${name}`)
          .join('\n');
        results.push({
          tool: 'list',
          args: m[1].trim(),
          output: entries.length ? lines : '(empty directory)'
        });
      } catch (err) {
        results.push({ tool: 'list', args: m[1].trim(), output: `[error] ${err instanceof Error ? err.message : String(err)}` });
      }
    }

    const openMatches = [...content.matchAll(OPEN_BLOCK_RE), ...content.matchAll(VOICE_OPEN_RE)];
    for (const m of openMatches) {
      const p = resolvePath(m[1].trim(), roots);
      if (!p) {
        results.push({ tool: 'open', args: m[1].trim(), output: '[error] path could not be resolved' });
        continue;
      }
      try {
        const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(p));
        await vscode.window.showTextDocument(doc, { preview: false });
        results.push({ tool: 'open', args: m[1].trim(), output: `opened ${p}` });
      } catch (err) {
        results.push({ tool: 'open', args: m[1].trim(), output: `[error] ${err instanceof Error ? err.message : String(err)}` });
      }
    }

    for (const block2 of parseFileBlocks(content)) {
      const p = resolvePath(block2.path, roots);
      const msg = p
        ? await writeFile(p, block2.text)
        : `[error] path could not be resolved ${block2.path}`;
      results.push({ tool: 'file', args: block2.path, output: msg });
    }

    const editMatches = [...content.matchAll(EDIT_BLOCK_RE), ...content.matchAll(VOICE_EDIT_RE)];
    for (const m of editMatches) {
      const pathArg = m[1].trim();
      const oldText = m[2];
      const newText = m[3];
      const p = resolvePath(pathArg, roots);
      
      if (!p) {
        results.push({ tool: 'edit', args: pathArg, output: '[error] path could not be resolved' });
        continue;
      }
      try {
        const textBytes = await vscode.workspace.fs.readFile(vscode.Uri.file(p));
        const currentText = Buffer.from(textBytes).toString('utf8').replace(/\r\n/g, '\n');
        const normalizedOld = oldText.replace(/\r\n/g, '\n');
        const normalizedNew = newText.replace(/\r\n/g, '\n');
        
        const count = currentText.split(normalizedOld).length - 1;
        if (count === 0) {
           results.push({ tool: 'edit', args: pathArg, output: '[error] old text block not found in file exactly as specified' });
        } else if (count > 1) {
           results.push({ tool: 'edit', args: pathArg, output: '[error] old text block found multiple times, please provide a more unique block' });
        } else {
           const updatedText = currentText.replace(normalizedOld, normalizedNew);
           await vscode.workspace.fs.writeFile(vscode.Uri.file(p), Buffer.from(updatedText, 'utf8'));
           results.push({ tool: 'edit', args: pathArg, output: `successfully edited ${p}` });
        }
      } catch (err) {
        results.push({ tool: 'edit', args: pathArg, output: `[error] ${err instanceof Error ? err.message : String(err)}` });
      }
    }
  }

  if (toolEnabled('vscode')) {
    for (const m of content.matchAll(VSCODE_BLOCK_RE)) {
      const command = extractAttr(m[1], 'command');
      if (!command) {
        results.push({ tool: 'vscode', args: m[0], output: '[error] missing command attribute' });
        continue;
      }
      let argv: unknown[] = [];
      const argsAttr = extractAttr(m[1], 'args');
      if (argsAttr) {
        try {
          const parsed = JSON.parse(argsAttr);
          argv = Array.isArray(parsed) ? parsed : [parsed];
        } catch {
          results.push({ tool: 'vscode', args: command, output: '[error] args must be a JSON array (or JSON value)' });
          continue;
        }
      }
      try {
        const value = await vscode.commands.executeCommand(command, ...argv);
        results.push({
          tool: 'vscode',
          args: command,
          output: value === undefined ? `ran ${command}` : `ran ${command} -> ${safeStringify(value)}`
        });
      } catch (err) {
        results.push({ tool: 'vscode', args: command, output: `[error] ${err instanceof Error ? err.message : String(err)}` });
      }
    }
  }

  return results;
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function extractAttr(attrs: string, name: string): string {
  const m = new RegExp(`(?:^|[\\s])${name}=(["'])(.*?)\\1`).exec(attrs);
  return m?.[2] ?? '';
}

function resolvePath(p: string, roots: string[]): string | undefined {
  if (!roots.length) return undefined;
  if (path.isAbsolute(p)) return p;
  for (const r of roots) {
    const c = path.join(r, p);
    if (fs.existsSync(c)) return c;
  }
  return path.join(roots[0], p);
}

async function writeFile(target: string, text: string): Promise<string> {
  try {
    await vscode.workspace.fs.createDirectory(vscode.Uri.file(path.dirname(target)));
    await vscode.workspace.fs.writeFile(vscode.Uri.file(target), Buffer.from(text, 'utf8'));
    let size = Buffer.byteLength(text, 'utf8');
    try {
      size = fs.statSync(target).size;
    } catch (_) {
      /* fall back to byteLength */
    }
    return `created ${target} (${size} bytes)`;
  } catch (err) {
    return `[error] ${err instanceof Error ? err.message : String(err)}`;
  }
}

export function runShell(command: string, cwd?: string): Promise<string> {
  return new Promise((resolve) => {
    childProcess.exec(
      command,
      { cwd, shell: process.env.ComSpec || 'cmd.exe', timeout: 45000, maxBuffer: 8 * 1024 * 1024 },
      (err, stdout, stderr) => {
        const out = (stdout || '') + (stderr ? `\n[stderr] ${stderr}` : '');
        if (err && !out.trim()) resolve(`[error] ${err.message}`);
        else resolve(out.trim() || (err ? `[done] exit ${err.code ?? '?'}` : '[no output]'));
      }
    );
  });
}

export async function streamCompletion(
  req: ChatRequest,
  onDelta: (text: string) => void
): Promise<{ content: string }> {
  const url = `${req.baseUrl.replace(/\/+$/, '')}/chat/completions`;
  const payload: Record<string, unknown> = {
    model: req.model,
    messages: req.messages,
    stream: true
  };
  if (typeof req.temperature === 'number') payload.temperature = req.temperature;
  if (typeof req.maxTokens === 'number') payload.max_tokens = req.maxTokens;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(req.apiKey ? { Authorization: `Bearer ${req.apiKey}` } : {})
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(300000)
  });
  if (!res.ok) {
    const errBody = await res.text().catch(() => '');
    throw new Error(`9 Router HTTP ${res.status}: ${errBody.slice(0, 500)}`);
  }
  if (!res.body) return { content: '' };

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let content = '';
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let idx: number;
      while ((idx = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, idx).trim();
        buffer = buffer.slice(idx + 1);
        if (!line.startsWith('data:')) continue;
        const data = line.slice(5).trim();
        if (data === '[DONE]') break;
        try {
          const parsed = JSON.parse(data) as { choices?: Array<{ delta?: Delta }> };
          const piece = parsed.choices?.[0]?.delta?.content ?? '';
          if (piece) {
            content += piece;
            onDelta(piece);
          }
        } catch {
          /* skip malformed SSE lines */
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
  return { content };
}

/**
 * Appender that suppresses <antigravity:...> tool blocks from the visible stream
 * while still forwarding everything else. Returns a function bound to `emit`.
 */
export function toolBlockAwareAppender(emit: (text: string) => void): (text: string) => void {
  let skipped = '';
  let inBlock = false;
  return (delta: string) => {
    let rest = delta;
    while (rest.length) {
      if (inBlock) {
        skipped += rest;
        const gt = skipped.indexOf('>');
        if (gt < 0) {
          rest = '';
          continue;
        }
        const before = skipped.slice(0, gt);
        if (/\/\s*$/.test(before)) {
          inBlock = false;
          const tail = skipped.slice(gt + 1);
          skipped = '';
          rest = tail;
          continue;
        }
        const vc = skipped.indexOf('</antigravity', gt);
        if (vc < 0) {
          rest = '';
          continue;
        }
        const ce = skipped.indexOf('>', vc);
        if (ce < 0) {
          rest = '';
          continue;
        }
        inBlock = false;
        const tail = skipped.slice(ce + 1);
        skipped = '';
        if (tail) rest = tail; else rest = '';
        continue;
      }
      const i = rest.indexOf('<antigravity');
      if (i < 0) {
        emit(rest);
        rest = '';
      } else {
        if (i > 0) emit(rest.slice(0, i));
        skipped = rest.slice(i);
        inBlock = true;
        rest = '';
      }
    }
  };
}
