import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { ChatMessage } from '../chat';
import { WebviewChatMessage } from '../ui/workflowWebview';

export interface VoiceTurnRecord {
  role: 'user' | 'ai';
  text: string;
  timestamp: string;
}

export interface ChatSession {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  activeModel: string;
  liveModel?: string;
  chatMessages: WebviewChatMessage[];
  chatHistory: ChatMessage[];
  voiceTurns: VoiceTurnRecord[];
}

export interface SessionSummary {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  messageCount: number;
  activeModel: string;
}

export interface SessionOptions {
  resumeOnOpen: boolean;
  persistHistory: boolean;
  unifiedVoiceAndText: boolean;
  maxPersistedTurns: number;
}

const ACTIVE_SESSION_KEY = 'antigravity.session.activeId';
const SESSION_REGISTRY_KEY = 'antigravity.session.registry';
const DEFAULT_MAX_TURNS = 50;

export class SessionManager {
  private static instance?: SessionManager;
  private _context?: vscode.ExtensionContext;
  private _activeSession?: ChatSession;
  private _saveTimer?: NodeJS.Timeout;
  private _sessionsCache: Map<string, ChatSession> = new Map();

  private constructor(context?: vscode.ExtensionContext) {
    this._context = context;
  }

  public static initialize(context: vscode.ExtensionContext): SessionManager {
    if (!SessionManager.instance) {
      SessionManager.instance = new SessionManager(context);
    } else {
      SessionManager.instance._context = context;
    }
    return SessionManager.instance;
  }

  public static getInstance(): SessionManager {
    if (!SessionManager.instance) {
      SessionManager.instance = new SessionManager();
    }
    return SessionManager.instance;
  }

  public getOptions(): SessionOptions {
    const cfg = vscode.workspace.getConfiguration('antigravity.session');
    return {
      resumeOnOpen: cfg.get<boolean>('resumeOnOpen') !== false,
      persistHistory: cfg.get<boolean>('persistHistory') !== false,
      unifiedVoiceAndText: cfg.get<boolean>('unifiedVoiceAndText') !== false,
      maxPersistedTurns: cfg.get<number>('maxPersistedTurns') ?? DEFAULT_MAX_TURNS
    };
  }

  private getSessionsDir(): string | undefined {
    const folders = vscode.workspace.workspaceFolders;
    if (!folders || folders.length === 0) return undefined;
    const dir = path.join(folders[0].uri.fsPath, '.antigravity', 'sessions');
    try {
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      return dir;
    } catch {
      return undefined;
    }
  }

  public getActiveSession(): ChatSession {
    const opts = this.getOptions();
    if (!this._activeSession) {
      if (opts.resumeOnOpen && opts.persistHistory) {
        this._activeSession = this.loadActiveSessionFromStorage();
      }
      if (!this._activeSession) {
        this._activeSession = this.createDefaultSession();
      }
    }
    return this._activeSession;
  }

  private createDefaultSession(initialModel?: string, title?: string): ChatSession {
    const now = Date.now();
    const model = initialModel ||
      (this._context?.workspaceState.get<string>('antigravity.models.selected')) ||
      'ag/gemini-3.8-flash-high';
    const sess: ChatSession = {
      id: `sess_${now}_${Math.random().toString(36).substring(2, 7)}`,
      title: title || `Session ${new Date(now).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`,
      createdAt: now,
      updatedAt: now,
      activeModel: model,
      chatMessages: [],
      chatHistory: [],
      voiceTurns: []
    };
    this._sessionsCache.set(sess.id, sess);
    return sess;
  }

  public createNewSession(initialModel?: string, title?: string): ChatSession {
    this.flushSync();
    const newSess = this.createDefaultSession(initialModel, title);
    this._activeSession = newSess;
    this.saveSessionImmediate(newSess);
    if (this._context) {
      this._context.workspaceState.update(ACTIVE_SESSION_KEY, newSess.id);
    }
    return newSess;
  }

  private loadActiveSessionFromStorage(): ChatSession | undefined {
    const activeId = this._context?.workspaceState.get<string>(ACTIVE_SESSION_KEY);
    if (activeId && this._sessionsCache.has(activeId)) {
      return this._sessionsCache.get(activeId);
    }

    // Try workspaceState
    if (activeId && this._context) {
      const stored = this._context.workspaceState.get<ChatSession>(`antigravity.session.data.${activeId}`);
      if (stored && stored.id) {
        this._sessionsCache.set(stored.id, stored);
        return stored;
      }
    }

    // Try disk storage
    const dir = this.getSessionsDir();
    if (dir) {
      try {
        if (activeId) {
          const filePath = path.join(dir, `${activeId}.json`);
          if (fs.existsSync(filePath)) {
            const content = fs.readFileSync(filePath, 'utf8');
            const parsed = JSON.parse(content) as ChatSession;
            if (parsed && parsed.id) {
              this._sessionsCache.set(parsed.id, parsed);
              return parsed;
            }
          }
        }

        // Fallback: pick the most recently modified session file
        const files = fs.readdirSync(dir).filter((f) => f.endsWith('.json'));
        if (files.length > 0) {
          files.sort((a, b) => {
            const statA = fs.statSync(path.join(dir, a)).mtimeMs;
            const statB = fs.statSync(path.join(dir, b)).mtimeMs;
            return statB - statA;
          });
          const latestFile = path.join(dir, files[0]);
          const content = fs.readFileSync(latestFile, 'utf8');
          const parsed = JSON.parse(content) as ChatSession;
          if (parsed && parsed.id) {
            this._sessionsCache.set(parsed.id, parsed);
            return parsed;
          }
        }
      } catch (err) {
        console.warn('[SessionManager] Failed to read session from disk:', err);
      }
    }

    return undefined;
  }

  public scheduleSave(): void {
    const opts = this.getOptions();
    if (!opts.persistHistory) return;

    if (this._saveTimer) {
      clearTimeout(this._saveTimer);
    }
    this._saveTimer = setTimeout(() => {
      this._saveTimer = undefined;
      if (this._activeSession) {
        this.saveSessionImmediate(this._activeSession);
      }
    }, 800);
  }

  public flushSync(): void {
    if (this._saveTimer) {
      clearTimeout(this._saveTimer);
      this._saveTimer = undefined;
    }
    if (this._activeSession) {
      this.saveSessionImmediate(this._activeSession);
    }
  }

  private saveSessionImmediate(session: ChatSession): void {
    const opts = this.getOptions();
    if (!opts.persistHistory) return;

    session.updatedAt = Date.now();
    this._sessionsCache.set(session.id, session);

    // Update session title if default and first user message is present
    if (session.chatMessages.length > 0 && session.title.startsWith('Session ')) {
      const firstUser = session.chatMessages.find((m) => m.sender === 'user' || (m.sender === 'voice' && m.from === 'user'));
      if (firstUser && firstUser.content) {
        const preview = firstUser.content.trim().slice(0, 32).replace(/[\r\n]+/g, ' ');
        session.title = preview ? `Chat: ${preview}${firstUser.content.length > 32 ? '…' : ''}` : session.title;
      }
    }

    // Save to workspaceState
    if (this._context) {
      this._context.workspaceState.update(ACTIVE_SESSION_KEY, session.id);
      this._context.workspaceState.update(`antigravity.session.data.${session.id}`, session);

      // Update registry
      const reg = this._context.workspaceState.get<SessionSummary[]>(SESSION_REGISTRY_KEY) || [];
      const filtered = reg.filter((s) => s.id !== session.id);
      filtered.unshift({
        id: session.id,
        title: session.title,
        createdAt: session.createdAt,
        updatedAt: session.updatedAt,
        messageCount: session.chatMessages.length,
        activeModel: session.activeModel
      });
      this._context.workspaceState.update(SESSION_REGISTRY_KEY, filtered.slice(0, 30));
    }

    // Save to disk
    const dir = this.getSessionsDir();
    if (dir) {
      try {
        const filePath = path.join(dir, `${session.id}.json`);
        fs.writeFileSync(filePath, JSON.stringify(session, null, 2), 'utf8');
      } catch (err) {
        console.warn('[SessionManager] Could not write session to disk:', err);
      }
    }
  }

  public appendWebviewMessage(msg: WebviewChatMessage): void {
    const session = this.getActiveSession();
    const existingIdx = session.chatMessages.findIndex((m) => m.id === msg.id);
    if (existingIdx >= 0) {
      session.chatMessages[existingIdx] = msg;
    } else {
      session.chatMessages.push(msg);
    }

    if (msg.sender === 'voice' && msg.content && msg.content.trim()) {
      const role = msg.from === 'user' ? 'user' : 'ai';
      const last = session.voiceTurns[session.voiceTurns.length - 1];
      if (!last || last.role !== role || last.text !== msg.content) {
        session.voiceTurns.push({
          role,
          text: msg.content,
          timestamp: msg.timestamp
        });
      }
    }

    this.scheduleSave();
  }

  public appendChatDelta(id: string, text: string): void {
    const session = this.getActiveSession();
    const existing = session.chatMessages.find((m) => m.id === id);
    if (existing) {
      existing.content += text;
      this.scheduleSave();
    }
  }

  public appendChatHistory(msg: ChatMessage): void {
    const session = this.getActiveSession();
    session.chatHistory.push(msg);

    const opts = this.getOptions();
    if (session.chatHistory.length > opts.maxPersistedTurns) {
      // Keep system message if present
      const sys = session.chatHistory.filter((m) => m.role === 'system');
      const nonSys = session.chatHistory.filter((m) => m.role !== 'system');
      session.chatHistory = [...sys, ...nonSys.slice(-opts.maxPersistedTurns)];
    }

    this.scheduleSave();
  }

  public appendVoiceTurn(text: string, from: 'user' | 'ai'): void {
    if (!text || !text.trim()) return;
    const session = this.getActiveSession();
    const last = session.voiceTurns[session.voiceTurns.length - 1];
    if (!last || last.role !== from || last.text !== text) {
      session.voiceTurns.push({
        role: from,
        text,
        timestamp: new Date().toLocaleTimeString()
      });
    }

    // Also mirror to chat history for LLM awareness if unified mode is enabled
    const opts = this.getOptions();
    if (opts.unifiedVoiceAndText && text.trim()) {
      session.chatHistory.push({
        role: from === 'user' ? 'user' : 'assistant',
        content: `[Voice ${from === 'user' ? 'User' : 'Assistant'}]: ${text}`
      });
    }

    this.scheduleSave();
  }

  public listSessions(): SessionSummary[] {
    if (this._context) {
      const reg = this._context.workspaceState.get<SessionSummary[]>(SESSION_REGISTRY_KEY);
      if (reg && reg.length > 0) return reg;
    }

    // Fallback: list disk sessions
    const dir = this.getSessionsDir();
    if (dir) {
      try {
        const files = fs.readdirSync(dir).filter((f) => f.endsWith('.json'));
        const summaries: SessionSummary[] = [];
        for (const file of files) {
          try {
            const raw = fs.readFileSync(path.join(dir, file), 'utf8');
            const s = JSON.parse(raw) as ChatSession;
            summaries.push({
              id: s.id,
              title: s.title || file.replace('.json', ''),
              createdAt: s.createdAt || 0,
              updatedAt: s.updatedAt || 0,
              messageCount: s.chatMessages?.length || 0,
              activeModel: s.activeModel || ''
            });
          } catch {}
        }
        summaries.sort((a, b) => b.updatedAt - a.updatedAt);
        return summaries;
      } catch {}
    }
    return [];
  }

  public switchSession(sessionId: string): ChatSession | undefined {
    this.flushSync();
    if (this._sessionsCache.has(sessionId)) {
      this._activeSession = this._sessionsCache.get(sessionId);
    } else {
      // Load from storage
      const dir = this.getSessionsDir();
      if (dir) {
        const file = path.join(dir, `${sessionId}.json`);
        if (fs.existsSync(file)) {
          try {
            const raw = fs.readFileSync(file, 'utf8');
            this._activeSession = JSON.parse(raw);
            this._sessionsCache.set(sessionId, this._activeSession!);
          } catch {}
        }
      }
    }

    if (this._activeSession && this._context) {
      this._context.workspaceState.update(ACTIVE_SESSION_KEY, this._activeSession.id);
    }
    return this._activeSession;
  }

  public clearActiveSession(): void {
    if (this._activeSession) {
      this._activeSession.chatMessages = [];
      this._activeSession.chatHistory = [];
      this._activeSession.voiceTurns = [];
      this._activeSession.updatedAt = Date.now();
      this.saveSessionImmediate(this._activeSession);
    }
  }

  public deleteSession(sessionId: string): void {
    this._sessionsCache.delete(sessionId);
    if (this._context) {
      this._context.workspaceState.update(`antigravity.session.data.${sessionId}`, undefined);
      const reg = this._context.workspaceState.get<SessionSummary[]>(SESSION_REGISTRY_KEY) || [];
      this._context.workspaceState.update(SESSION_REGISTRY_KEY, reg.filter((s) => s.id !== sessionId));
    }
    const dir = this.getSessionsDir();
    if (dir) {
      const file = path.join(dir, `${sessionId}.json`);
      if (fs.existsSync(file)) {
        try { fs.unlinkSync(file); } catch {}
      }
    }
    if (this._activeSession?.id === sessionId) {
      this._activeSession = this.createNewSession();
    }
  }

  public clearAllSessions(): void {
    this._sessionsCache.clear();
    if (this._context) {
      this._context.workspaceState.update(ACTIVE_SESSION_KEY, undefined);
      this._context.workspaceState.update(SESSION_REGISTRY_KEY, []);
    }
    const dir = this.getSessionsDir();
    if (dir) {
      try {
        const files = fs.readdirSync(dir);
        for (const f of files) {
          if (f.endsWith('.json')) {
            try { fs.unlinkSync(path.join(dir, f)); } catch {}
          }
        }
      } catch {}
    }
    this._activeSession = this.createDefaultSession();
  }

  /**
   * Generates a concise context block of the ongoing session to inject into Gemini Live
   * or a newly started model conversation, ensuring seamless resumption where the user left off.
   */
  public getResumeContext(maxChars: number = 3200): string {
    const opts = this.getOptions();
    if (!opts.resumeOnOpen || !opts.persistHistory) return '';

    const session = this.getActiveSession();
    const relevantMessages = session.chatMessages.filter(
      (m) => (m.sender === 'user' || m.sender === 'ai' || m.sender === 'voice') && m.content && m.content.trim()
    );

    if (relevantMessages.length === 0) return '';

    // Take the last 10 messages
    const recent = relevantMessages.slice(-10);
    const lines: string[] = [];
    lines.push('[RESUMED CONVERSATION CONTEXT - YOU ARE CONTINUING WHERE THE USER LEFT OFF]');
    lines.push('The user paused/closed the session earlier and is now resuming with you. Here is the recent conversation:');

    for (const msg of recent) {
      const speaker = (msg.sender === 'user' || (msg.sender === 'voice' && msg.from === 'user')) ? 'User' : 'Assistant';
      const cleanContent = msg.content.replace(/[\r\n]+/g, ' ').slice(0, 300);
      lines.push(`${speaker}: ${cleanContent}`);
    }

    lines.push('[END RESUMED CONTEXT]');
    lines.push('Continue smoothly from this context. Do not recite or repeat the history unless asked.');

    const result = lines.join('\n');
    return result.length > maxChars ? result.slice(result.length - maxChars) : result;
  }

  public exportSessionMarkdown(session?: ChatSession): string {
    const target = session || this.getActiveSession();
    const lines: string[] = [];
    lines.push(`# Chat Session: ${target.title}`);
    lines.push(`- **Session ID**: \`${target.id}\``);
    lines.push(`- **Model**: \`${target.activeModel}\``);
    lines.push(`- **Created**: ${new Date(target.createdAt).toLocaleString()}`);
    lines.push(`- **Last Updated**: ${new Date(target.updatedAt).toLocaleString()}`);
    lines.push('');
    lines.push('---');
    lines.push('');

    for (const msg of target.chatMessages) {
      const time = msg.timestamp || '';
      if (msg.sender === 'user') {
        lines.push(`### 👤 User (${time})`);
        lines.push(msg.content);
      } else if (msg.sender === 'ai') {
        lines.push(`### 🤖 ${msg.roleModel || 'AI'} (${time})`);
        lines.push(msg.content);
      } else if (msg.sender === 'voice') {
        const isUser = msg.from === 'user';
        lines.push(`### 🎙️ ${isUser ? 'User (Voice)' : 'AI (Voice)'} (${time})`);
        lines.push(msg.content);
      } else if (msg.sender === 'role') {
        lines.push(`### 🛠️ Role: ${msg.roleName || 'Agent'} [${msg.status || 'Done'}]`);
        lines.push(`*Task: ${msg.taskName || ''}*`);
        lines.push(msg.content);
      } else if (msg.sender === 'system') {
        lines.push(`> ℹ️ *${msg.content}*`);
      }
      lines.push('');
    }
    return lines.join('\n');
  }
}
