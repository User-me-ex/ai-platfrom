/**
 * 9 Router CLI — Session Manager
 *
 * Manages conversation session persistence with SQLite.
 */

import type { Session, Message, SessionManager } from "../core/types";
import { getSessionsDbPath } from "../utils/paths";
import { SessionNotFoundError } from "../core/errors";
import { Database } from "bun:sqlite";

export class SessionManagerImpl implements SessionManager {
  private db: Database;
  private currentSessionId: string | null = null;

  constructor() {
    this.db = new Database(getSessionsDbPath());
    this.initializeSchema();
  }

  private initializeSchema(): void {
    this.db.run(`
      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL DEFAULT '',
        model_id TEXT NOT NULL,
        system_prompt TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        token_count INTEGER DEFAULT 0,
        message_count INTEGER DEFAULT 0,
        metadata TEXT
      )
    `);

    this.db.run(`
      CREATE TABLE IF NOT EXISTS messages (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        model_id TEXT,
        tokens_in INTEGER DEFAULT 0,
        tokens_out INTEGER DEFAULT 0,
        created_at INTEGER NOT NULL,
        metadata TEXT,
        FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
      )
    `);

    // Full-text search virtual table
    this.db.run(`
      CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts USING fts5(
        content,
        content=messages,
        content_rowid=rowid
      )
    `);

    // Triggers to keep FTS in sync
    this.db.run(`
      CREATE TRIGGER IF NOT EXISTS messages_ai AFTER INSERT ON messages BEGIN
        INSERT INTO messages_fts(rowid, content) VALUES (new.rowid, new.content);
      END
    `);

    this.db.run(`
      CREATE TRIGGER IF NOT EXISTS messages_ad AFTER DELETE ON messages BEGIN
        INSERT INTO messages_fts(messages_fts, rowid, content) VALUES('delete', old.rowid, old.content);
      END
    `);

    this.db.run(`
      CREATE TRIGGER IF NOT EXISTS messages_au AFTER UPDATE ON messages BEGIN
        INSERT INTO messages_fts(messages_fts, rowid, content) VALUES('delete', old.rowid, old.content);
        INSERT INTO messages_fts(rowid, content) VALUES (new.rowid, new.content);
      END
    `);

    // Indexes
    this.db.run(`CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(session_id)`);
    this.db.run(`CREATE INDEX IF NOT EXISTS idx_messages_created ON messages(created_at)`);
    this.db.run(`CREATE INDEX IF NOT EXISTS idx_sessions_updated ON sessions(updated_at)`);
  }

  async createSession(name?: string, modelId?: string, systemPrompt?: string): Promise<Session> {
    const id = crypto.randomUUID();
    const now = Date.now();

    this.db.run(
      `INSERT INTO sessions (id, name, model_id, system_prompt, created_at, updated_at, token_count, message_count, metadata)
       VALUES (?, ?, ?, ?, ?, ?, 0, 0, '{}')`,
      [id, name ?? "", modelId ?? "", systemPrompt ?? null, now, now]
    );

    const session: Session = {
      id,
      name: name ?? "",
      modelId: modelId ?? "",
      systemPrompt,
      messages: [],
      createdAt: now,
      updatedAt: now,
      tokenCount: 0,
      messageCount: 0,
    };

    this.currentSessionId = id;
    return session;
  }

  async getSession(id: string): Promise<Session | null> {
    const row = this.db.query(`SELECT * FROM sessions WHERE id = ?`).get(id) as Record<string, unknown> | null;
    if (!row) return null;

    const messages = this.db.query(
      `SELECT * FROM messages WHERE session_id = ? ORDER BY created_at ASC`
    ).all(id) as Record<string, unknown>[];

    return {
      id: row.id as string,
      name: row.name as string,
      modelId: row.model_id as string,
      systemPrompt: row.system_prompt as string | undefined,
      messages: messages.map(this.rowToMessage),
      createdAt: row.created_at as number,
      updatedAt: row.updated_at as number,
      tokenCount: row.token_count as number,
      messageCount: row.message_count as number,
      metadata: row.metadata ? JSON.parse(row.metadata as string) : undefined,
    };
  }

  async listSessions(limit = 50, offset = 0): Promise<Session[]> {
    const rows = this.db.query(
      `SELECT * FROM sessions ORDER BY updated_at DESC LIMIT ? OFFSET ?`
    ).all(limit, offset) as Record<string, unknown>[];

    // For list operations, don't load messages (performance)
    return rows.map((row) => ({
      id: row.id as string,
      name: row.name as string,
      modelId: row.model_id as string,
      systemPrompt: row.system_prompt as string | undefined,
      messages: [],
      createdAt: row.created_at as number,
      updatedAt: row.updated_at as number,
      tokenCount: row.token_count as number,
      messageCount: row.message_count as number,
      metadata: row.metadata ? JSON.parse(row.metadata as string) : undefined,
    }));
  }

  async updateSession(id: string, updates: Partial<Session>): Promise<void> {
    const fields: string[] = [];
    const values: unknown[] = [];

    if (updates.name !== undefined) { fields.push("name = ?"); values.push(updates.name); }
    if (updates.modelId !== undefined) { fields.push("model_id = ?"); values.push(updates.modelId); }
    if (updates.systemPrompt !== undefined) { fields.push("system_prompt = ?"); values.push(updates.systemPrompt); }
    if (updates.tokenCount !== undefined) { fields.push("token_count = ?"); values.push(updates.tokenCount); }
    if (updates.messageCount !== undefined) { fields.push("message_count = ?"); values.push(updates.messageCount); }
    if (updates.metadata !== undefined) { fields.push("metadata = ?"); values.push(JSON.stringify(updates.metadata)); }

    fields.push("updated_at = ?");
    values.push(Date.now());

    values.push(id);

    this.db.run(`UPDATE sessions SET ${fields.join(", ")} WHERE id = ?`, values as unknown as import("bun:sqlite").SQLQueryBindings[]);
  }

  async deleteSession(id: string): Promise<void> {
    this.db.run(`DELETE FROM messages WHERE session_id = ?`, [id]);
    this.db.run(`DELETE FROM sessions WHERE id = ?`, [id]);
  }

  async searchSessions(query: string): Promise<Session[]> {
    const rows = this.db.query(`
      SELECT DISTINCT s.* FROM sessions s
      JOIN messages m ON m.session_id = s.id
      WHERE m.content LIKE ? OR s.name LIKE ?
      ORDER BY s.updated_at DESC
      LIMIT 20
    `).all(`%${query}%`, `%${query}%`) as Record<string, unknown>[];

    return rows.map((row) => ({
      id: row.id as string,
      name: row.name as string,
      modelId: row.model_id as string,
      systemPrompt: row.system_prompt as string | undefined,
      messages: [],
      createdAt: row.created_at as number,
      updatedAt: row.updated_at as number,
      tokenCount: row.token_count as number,
      messageCount: row.message_count as number,
    }));
  }

  async addMessage(sessionId: string, message: Message): Promise<void> {
    this.db.run(
      `INSERT INTO messages (id, session_id, role, content, model_id, tokens_in, tokens_out, created_at, metadata)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        message.id,
        sessionId,
        message.role,
        message.content,
        message.modelId ?? null,
        message.tokensIn ?? 0,
        message.tokensOut ?? 0,
        message.createdAt,
        message.metadata ? JSON.stringify(message.metadata) : null,
      ]
    );

    // Update session counts
    this.db.run(
      `UPDATE sessions SET message_count = message_count + 1, updated_at = ? WHERE id = ?`,
      [Date.now(), sessionId]
    );
  }

  async exportSession(id: string, format: "json" | "md"): Promise<string> {
    const session = await this.getSession(id);
    if (!session) throw new SessionNotFoundError(id);

    if (format === "json") {
      return JSON.stringify(session, null, 2);
    }

    // Markdown format
    let md = `# Chat Session: ${session.name || session.id}\n\n`;
    md += `- **Model:** ${session.modelId}\n`;
    md += `- **Date:** ${new Date(session.createdAt).toISOString()}\n`;
    md += `- **Messages:** ${session.messageCount}\n\n`;
    md += `---\n\n`;

    for (const msg of session.messages) {
      const roleLabel = msg.role === "user" ? "You" : msg.role === "assistant" ? "AI" : msg.role;
      md += `### ${roleLabel}\n\n${msg.content}\n\n`;
    }

    return md;
  }

  async importSession(data: string): Promise<Session> {
    const parsed = JSON.parse(data);
    const session = parsed as Session;

    this.db.run(
      `INSERT INTO sessions (id, name, model_id, system_prompt, created_at, updated_at, token_count, message_count, metadata)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        session.id,
        session.name,
        session.modelId,
        session.systemPrompt ?? null,
        session.createdAt,
        session.updatedAt,
        session.tokenCount,
        session.messageCount,
        session.metadata ? JSON.stringify(session.metadata) : null,
      ]
    );

    for (const msg of session.messages) {
      await this.addMessage(session.id, msg);
    }

    return session;
  }

  async getCurrentSession(): Promise<Session | null> {
    if (!this.currentSessionId) return null;
    return this.getSession(this.currentSessionId);
  }

  async setCurrentSession(id: string): Promise<void> {
    const exists = await this.getSession(id);
    if (!exists) throw new SessionNotFoundError(id);
    this.currentSessionId = id;
  }

  private rowToMessage(row: Record<string, unknown>): Message {
    return {
      id: row.id as string,
      role: row.role as Message["role"],
      content: row.content as string,
      modelId: row.model_id as string | undefined,
      tokensIn: row.tokens_in as number | undefined,
      tokensOut: row.tokens_out as number | undefined,
      createdAt: row.created_at as number,
      metadata: row.metadata ? JSON.parse(row.metadata as string) as Record<string, unknown> : undefined,
    };
  }

  close(): void {
    this.db.close();
  }
}
