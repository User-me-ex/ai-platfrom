/**
 * 9 Router CLI — Memory System
 *
 * Inspired by Hermes Agent's memory management:
 * - FTS5 full-text search across all past conversations
 * - Vector memory for semantic recall (provider-based)
 * - Cross-session recall with prefetch/sync lifecycle
 * - Context compression for long conversations
 * - User modeling across sessions
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { EventBus } from "../core/events";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface MemoryRecord {
  id: string;
  sessionId: string;
  role: "user" | "assistant" | "system";
  content: string;
  tokens: number;
  timestamp: number;
  metadata?: Record<string, unknown>;
}

export interface SearchResult {
  record: MemoryRecord;
  score: number;
  snippet: string;
  sessionName?: string;
}

export interface VectorMemoryEntry {
  id: string;
  embedding: number[];
  content: string;
  metadata: Record<string, unknown>;
  timestamp: number;
}

export interface UserProfile {
  userId: string;
  topics: Map<string, number>; // topic → frequency
  languagePatterns: string[];
  preferredModel?: string;
  commonCommands: string[];
  sessionCount: number;
  totalTokens: number;
  firstSeen: number;
  lastSeen: number;
}

export interface MemoryProvider {
  name: string;
  buildSystemPrompt(): string;
  prefetchAll(message: string): Promise<SearchResult[]>;
  syncAll(userMsg: string, assistantResponse: string): Promise<void>;
  shutdown(): Promise<void>;
}

// ─── FTS5 Memory Store ────────────────────────────────────────────────────────

export class FTS5MemoryStore {
  private records: MemoryRecord[] = [];
  private indexPath: string;
  private maxRecords: number;

  constructor(storagePath: string, maxRecords = 10000) {
    this.indexPath = join(storagePath, "memory-index.json");
    this.maxRecords = maxRecords;
    this.load();
  }

  private load(): void {
    try {
      if (existsSync(this.indexPath)) {
        const data = JSON.parse(readFileSync(this.indexPath, "utf-8"));
        this.records = data.records ?? [];
      }
    } catch { this.records = []; }
  }

  private save(): void {
    try {
      const dir = this.indexPath.split("/").slice(0, -1).join("/") || ".";
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
      writeFileSync(this.indexPath, JSON.stringify({ records: this.records.slice(-this.maxRecords) }));
    } catch { /* silent */ }
  }

  /** Add a memory record */
  add(record: MemoryRecord): void {
    this.records.push(record);
    if (this.records.length > this.maxRecords) {
      this.records = this.records.slice(-this.maxRecords);
    }
    this.save();
  }

  /** Full-text search across all records */
  search(query: string, limit = 10): SearchResult[] {
    const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
    if (terms.length === 0) return [];

    const scored: Array<{ record: MemoryRecord; score: number }> = [];

    for (const record of this.records) {
      const content = record.content.toLowerCase();
      let score = 0;

      for (const term of terms) {
        const idx = content.indexOf(term);
        if (idx !== -1) {
          score += 1 + (term.length / content.length) * 10;
          // Bonus for matches in first 200 chars
          if (idx < 200) score += 3;
        }
      }

      // Recency bonus
      const age = Date.now() - record.timestamp;
      const recencyBonus = Math.max(0, 10 - age / (1000 * 60 * 60 * 24)); // 10pts decaying over 10 days
      score += recencyBonus;

      if (score > 0) {
        scored.push({ record, score });
      }
    }

    // Sort by score descending
    scored.sort((a, b) => b.score - a.score);

    return scored.slice(0, limit).map(({ record, score }) => ({
      record,
      score,
      snippet: this.makeSnippet(record.content),
    }));
  }

  /** Search by session ID */
  getSessionRecords(sessionId: string): MemoryRecord[] {
    return this.records.filter((r) => r.sessionId === sessionId);
  }

  /** Get all sessions with their metadata */
  getSessionSummaries(): Map<string, { messageCount: number; lastActive: number; topics: string[] }> {
    const summaries = new Map<string, { messageCount: number; lastActive: number; topics: string[] }>();
    for (const record of this.records) {
      const existing = summaries.get(record.sessionId) ?? { messageCount: 0, lastActive: 0, topics: [] };
      existing.messageCount++;
      existing.lastActive = Math.max(existing.lastActive, record.timestamp);
      summaries.set(record.sessionId, existing);
    }
    return summaries;
  }

  /** Delete records for a session */
  deleteSession(sessionId: string): void {
    this.records = this.records.filter((r) => r.sessionId !== sessionId);
    this.save();
  }

  /** Total record count */
  get count(): number {
    return this.records.length;
  }

  private makeSnippet(text: string, maxLen = 120): string {
    if (text.length <= maxLen) return text;
    return text.slice(0, maxLen - 3) + "...";
  }
}

// ─── Vector Memory Store ──────────────────────────────────────────────────────

export class VectorMemoryStore {
  private entries: VectorMemoryEntry[] = [];
  private storagePath: string;

  constructor(storagePath: string) {
    this.storagePath = join(storagePath, "vector-memory.json");
    this.load();
  }

  private load(): void {
    try {
      if (existsSync(this.storagePath)) {
        this.entries = JSON.parse(readFileSync(this.storagePath, "utf-8"));
      }
    } catch { this.entries = []; }
  }

  private save(): void {
    try {
      const dir = this.storagePath.split("/").slice(0, -1).join("/") || ".";
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
      writeFileSync(this.storagePath, JSON.stringify(this.entries));
    } catch { /* silent */ }
  }

  /** Add a vector entry */
  add(entry: VectorMemoryEntry): void {
    this.entries.push(entry);
    this.save();
  }

  /** Simple cosine similarity search (placeholder — real impl would use HNSW) */
  search(query: number[], topK = 5): Array<{ entry: VectorMemoryEntry; score: number }> {
    const scored = this.entries.map((entry) => ({
      entry,
      score: this.cosineSimilarity(query, entry.embedding),
    }));
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, topK);
  }

  /** Convert text to a simple bag-of-words embedding (placeholder) */
  textToEmbedding(text: string): number[] {
    const words = text.toLowerCase().split(/\W+/).filter(Boolean);
    const freq = new Map<string, number>();
    for (const word of words) {
      freq.set(word, (freq.get(word) ?? 0) + 1);
    }
    // Return normalized frequency vector for common words
    const commonWords = ["the", "a", "is", "to", "in", "for", "of", "and", "that", "this",
      "with", "on", "as", "at", "by", "from", "it", "or", "an", "be",
      "was", "are", "were", "been", "being", "have", "has", "had", "do", "does",
      "did", "will", "would", "could", "should", "may", "might", "shall", "can", "need",
      "function", "class", "import", "export", "const", "let", "var", "async", "await", "return"];
    const embedding = commonWords.map((w) => freq.get(w) ?? 0);
    const norm = Math.sqrt(embedding.reduce((sum, v) => sum + v * v, 0)) || 1;
    return embedding.map((v) => v / norm);
  }

  private cosineSimilarity(a: number[], b: number[]): number {
    if (a.length !== b.length || a.length === 0) return 0;
    let dot = 0, normA = 0, normB = 0;
    for (let i = 0; i < a.length; i++) {
      const av = a[i] as number;
      const bv = b[i] as number;
      dot += av * bv;
      normA += av * av;
      normB += bv * bv;
    }
    const denom = Math.sqrt(normA) * Math.sqrt(normB);
    return denom === 0 ? 0 : dot / denom;
  }

  /** Total entry count */
  get count(): number {
    return this.entries.length;
  }
}

// ─── User Profile Manager ─────────────────────────────────────────────────────

export class UserProfileManager {
  private profiles = new Map<string, UserProfile>();
  private storagePath: string;

  constructor(storagePath: string) {
    this.storagePath = join(storagePath, "user-profiles.json");
    this.load();
  }

  private load(): void {
    try {
      if (existsSync(this.storagePath)) {
        const raw = JSON.parse(readFileSync(this.storagePath, "utf-8"));
        for (const [key, val] of Object.entries(raw)) {
          const profile = val as Omit<UserProfile, "topics">;
          this.profiles.set(key, {
            ...profile,
            topics: new Map(Object.entries((val as Record<string, unknown>)?.topics as Record<string, number> ?? {})),
          });
        }
      }
    } catch { /* silent */ }
  }

  private save(): void {
    try {
      const dir = this.storagePath.split("/").slice(0, -1).join("/") || ".";
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
      const raw: Record<string, unknown> = {};
      for (const [key, profile] of this.profiles) {
        raw[key] = { ...profile, topics: Object.fromEntries(profile.topics) };
      }
      writeFileSync(this.storagePath, JSON.stringify(raw));
    } catch { /* silent */ }
  }

  /** Get or create a user profile */
  getProfile(userId: string): UserProfile {
    let profile = this.profiles.get(userId);
    if (!profile) {
      profile = {
        userId,
        topics: new Map(),
        languagePatterns: [],
        commonCommands: [],
        sessionCount: 0,
        totalTokens: 0,
        firstSeen: Date.now(),
        lastSeen: Date.now(),
      };
      this.profiles.set(userId, profile);
    }
    return profile;
  }

  /** Record a user message to build profile */
  recordMessage(userId: string, content: string, tokens: number): void {
    const profile = this.getProfile(userId);
    profile.lastSeen = Date.now();
    profile.totalTokens += tokens;

    // Extract topics (simple noun phrase detection)
    const words = content.toLowerCase().split(/\W+/).filter(Boolean);
    for (const word of words) {
      if (word.length > 4 && !["this", "that", "with", "from", "have", "been"].includes(word)) {
        profile.topics.set(word, (profile.topics.get(word) ?? 0) + 1);
      }
    }

    // Detect language patterns
    if (content.includes("```")) profile.languagePatterns.push("code_block");
    if (content.includes("```ts") || content.includes("```typescript")) profile.languagePatterns.push("typescript");
    if (content.includes("```py") || content.includes("```python")) profile.languagePatterns.push("python");
    if (content.includes("```js") || content.includes("```javascript")) profile.languagePatterns.push("javascript");

    this.save();
  }

  /** Record a command usage */
  recordCommand(userId: string, command: string): void {
    const profile = this.getProfile(userId);
    if (!profile.commonCommands.includes(command)) {
      profile.commonCommands.push(command);
      if (profile.commonCommands.length > 20) profile.commonCommands.shift();
    }
    this.save();
  }

  /** Increment session count */
  incrementSessions(userId: string): void {
    const profile = this.getProfile(userId);
    profile.sessionCount++;
    this.save();
  }

  /** Get top topics for a user */
  getTopTopics(userId: string, n = 10): string[] {
    const profile = this.getProfile(userId);
    return [...profile.topics.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, n)
      .map(([topic]) => topic);
  }
}

// ─── Memory Manager ───────────────────────────────────────────────────────────

export class MemoryManager {
  readonly fts5: FTS5MemoryStore;
  readonly vector: VectorMemoryStore;
  readonly profiles: UserProfileManager;
  private providers: MemoryProvider[] = [];
  private eventBus: EventBus;

  constructor(storagePath: string, eventBus: EventBus) {
    this.eventBus = eventBus;
    if (!existsSync(storagePath)) mkdirSync(storagePath, { recursive: true });

    this.fts5 = new FTS5MemoryStore(storagePath);
    this.vector = new VectorMemoryStore(storagePath);
    this.profiles = new UserProfileManager(storagePath);
  }

  /** Register an external memory provider */
  registerProvider(provider: MemoryProvider): void {
    if (this.providers.length >= 1) {
      return; // Only one external provider allowed (Hermes pattern)
    }
    this.providers.push(provider);
  }

  /** Build a system prompt incorporating memory context */
  async buildEnhancedSystemPrompt(basePrompt: string, userId: string): Promise<string> {
    const parts: string[] = [basePrompt];

    // Add profile context
    const profile = this.profiles.getProfile(userId);
    if (profile.topics.size > 0) {
      const topTopics = this.profiles.getTopTopics(userId, 5);
      parts.push(`\n[User Context] Known interests: ${topTopics.join(", ")}`);
    }
    if (profile.commonCommands.length > 0) {
      parts.push(`[User Commands] Frequently used: ${profile.commonCommands.slice(0, 5).join(", ")}`);
    }

    // Add provider prompts
    for (const provider of this.providers) {
      parts.push(provider.buildSystemPrompt());
    }

    return parts.join("\n");
  }

  /** Prefetch relevant memories before processing a user message */
  async prefetchAll(userMessage: string): Promise<SearchResult[]> {
    const results: SearchResult[] = [];

    // FTS5 search
    const ftsResults = this.fts5.search(userMessage, 5);
    results.push(...ftsResults);

    // Vector search
    const embedding = this.vector.textToEmbedding(userMessage);
    const vectorResults = this.vector.search(embedding, 3);
    for (const vr of vectorResults) {
      if (vr?.entry) this.eventBus.emit("memory:search", userMessage, [vr.entry]);
    }

    // Provider prefetch
    for (const provider of this.providers) {
      try {
        const providerResults = await provider.prefetchAll(userMessage);
        results.push(...providerResults);
      } catch { /* silent */ }
    }

    // Deduplicate by record ID
    const seen = new Set<string>();
    const deduped: SearchResult[] = [];
    for (const r of results) {
      const id = r?.record?.id;
      if (id && !seen.has(id)) {
        seen.add(id);
        deduped.push(r);
      }
    }

    return deduped;
  }

  /** Sync memories after a turn completes */
  async syncAll(userMsg: string, assistantResponse: string): Promise<void> {
    for (const provider of this.providers) {
      try {
        await provider.syncAll(userMsg, assistantResponse);
      } catch { /* silent */ }
    }
  }

  /** Add a memory record */
  addRecord(record: MemoryRecord): void {
    this.fts5.add(record);
    const embedding = this.vector.textToEmbedding(record.content);
    this.vector.add({
      id: record.id,
      embedding,
      content: record.content,
      metadata: { sessionId: record.sessionId, role: record.role, tokens: record.tokens },
      timestamp: record.timestamp,
    });
  }

  /** Search across all memory stores */
  search(query: string, limit = 10): SearchResult[] {
    return this.fts5.search(query, limit);
  }

  /** Shutdown all providers */
  async shutdown(): Promise<void> {
    const timeout = 5000;
    const timeoutPromise = new Promise<void>((resolve) => setTimeout(resolve, timeout));
    const shutdownPromise = Promise.all(this.providers.map((p) => p.shutdown().catch(() => {}))).then(() => {});
    await Promise.race([shutdownPromise, timeoutPromise]);
  }
}
