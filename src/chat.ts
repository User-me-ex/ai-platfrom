import * as vscode from 'vscode';
import * as childProcess from 'child_process';
import * as path from 'path';
import * as os from 'os';

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
const READ_BLOCK_RE = /<antigravity:read\s+path=["']([^"']+)["']\s*\/>/gi;
const LIST_BLOCK_RE = /<antigravity:list\s+path=["']([^"']*)["']\s*\/>/gi;
const SHELL_BLOCK_RE = /<antigravity:shell\s+command=["']([^"']*)["']\s*\/>/gi;
const OPEN_BLOCK_RE = /<antigravity:open\s+path=["']([^"']+)["']\s*\/>/gi;
const VSCODE_BLOCK_RE = /<antigravity:vscode\b([^>]*?)\/>/gi;
const TOOL_BLOCK_OPEN = '<antigravity';

export const AGENT_SYSTEM = [
  'You are a coding agent running inside the user\'s VS Code (Windows), powered by the local 9 Router gateway.',
  'You have full access to the machine. Available tools:',
  '- <antigravity:file path="...">content</antigravity:file>  -> create or overwrite any file (absolute path, or relative to the workspace folder).',
  '- <antigravity:read path="..."/>  -> read any file; its contents are returned to you.',
  '- <antigravity:list path="..."/>  -> list any directory; entries are returned to you.',
  '- <antigravity:shell command="..."/>  -> run any shell command on this Windows machine (PowerShell-friendly commands work best: Get-ChildItem, Get-Content, type, dir).',
  '- <antigravity:vscode command="..." args=\'[json args]\'/>  -> run a VS Code command (e.g. workbench.action.openSettings, editor.action.formatDocument, or any contributed command).',
  '- <antigravity:open path="..."/>  -> open a file in the VS Code editor.',
  'Tool results are returned to you automatically - use them and continue; never invent file contents you have not read.',
  'To achieve multi-step goals (list -> read -> edit -> verify), use tools and react to each result.'
].join('\n');

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
    .replace(READ_BLOCK_RE, '')
    .replace(LIST_BLOCK_RE, '')
    .replace(SHELL_BLOCK_RE, '')
    .replace(OPEN_BLOCK_RE, '')
    .replace(VSCODE_BLOCK_RE, '')
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
  return out;
}

export function hasToolBlocks(content: string): boolean {
  return content.includes(TOOL_BLOCK_OPEN);
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
  }

  if (toolEnabled('files')) {
    for (const m of content.matchAll(READ_BLOCK_RE)) {
      const p = resolvePath(m[1].trim(), roots);
      if (!p) {
        results.push({ tool: 'read', args: m[1].trim(), output: '[error] path could not be resolved' });
        continue;
      }
      try {
        const text = await vscode.workspace.fs.readFile(vscode.Uri.file(p));
        results.push({ tool: 'read', args: m[1].trim(), output: Buffer.from(text).toString('utf8') });
      } catch (err) {
        results.push({ tool: 'read', args: m[1].trim(), output: `[error] ${err instanceof Error ? err.message : String(err)}` });
      }
    }

    for (const m of content.matchAll(LIST_BLOCK_RE)) {
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

    for (const m of content.matchAll(OPEN_BLOCK_RE)) {
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
  if (roots.length !== 1) return undefined;
  return path.join(roots[0], p);
}

async function writeFile(target: string, text: string): Promise<string> {
  try {
    await vscode.workspace.fs.createDirectory(vscode.Uri.file(path.dirname(target)));
    await vscode.workspace.fs.writeFile(vscode.Uri.file(target), Buffer.from(text, 'utf8'));
    return `created ${target}`;
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
