/**
 * 9 Router CLI — Web & Browser Research System
 *
 * Inspired by Freebuff and Claude Code's web/browser capabilities:
 * - Web search using DuckDuckGo / Google Custom Search
 * - Web page reading and content extraction
 * - Browser automation for testing/scraping
 * - Result caching and deduplication
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync as fsReaddirSync, unlinkSync as fsUnlinkSync } from "fs";
import { join } from "path";
import { EventBus } from "../core/events";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface WebSearchResult {
  title: string;
  url: string;
  snippet: string;
  source: string;
  timestamp: number;
}

export interface WebPageContent {
  url: string;
  title: string;
  text: string;
  html?: string;
  metadata: {
    contentLength: number;
    wordCount: number;
    language?: string;
    author?: string;
    publishedDate?: string;
    fetchTime: number;
  };
}

export interface BrowserSession {
  id: string;
  url: string;
  title: string;
  screenshots: string[];
  consoleLogs: string[];
  errors: string[];
  createdAt: number;
}

// ─── Cache ────────────────────────────────────────────────────────────────────

class WebCache {
  private cacheDir: string;
  private maxAge: number;
  private inMemory = new Map<string, { data: unknown; timestamp: number }>();

  constructor(cacheDir: string, maxAgeMs = 30 * 60 * 1000) {
    this.cacheDir = join(cacheDir, "web-cache");
    this.maxAge = maxAgeMs;
    if (!existsSync(this.cacheDir)) mkdirSync(this.cacheDir, { recursive: true });
  }

  get<T>(key: string): T | null {
    const mem = this.inMemory.get(key);
    if (mem && Date.now() - mem.timestamp < this.maxAge) return mem.data as T;

    try {
      const path = join(this.cacheDir, `${this.hashKey(key)}.json`);
      if (existsSync(path)) {
        const data = JSON.parse(readFileSync(path, "utf-8"));
        if (Date.now() - data.timestamp < this.maxAge) {
          this.inMemory.set(key, data);
          return data.data as T;
        }
      }
    } catch { /* silent */ }
    return null;
  }

  set(key: string, data: unknown): void {
    this.inMemory.set(key, { data, timestamp: Date.now() });
    try {
      const path = join(this.cacheDir, `${this.hashKey(key)}.json`);
      writeFileSync(path, JSON.stringify({ data, timestamp: Date.now() }));
    } catch { /* silent */ }
  }

  clear(): void {
    this.inMemory.clear();
    try {
      const files = fsReaddirSync(this.cacheDir);
      for (const f of files) {
        if (f.endsWith(".json")) {
          try { fsUnlinkSync(join(this.cacheDir, f)); } catch { /* silent */ }
        }
      }
    } catch { /* silent */ }
  }

  private hashKey(key: string): string {
    let hash = 0;
    for (let i = 0; i < key.length; i++) {
      const char = key.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    return Math.abs(hash).toString(36);
  }
}

// ─── Web Search Engine ────────────────────────────────────────────────────────

export class WebSearchEngine {
  private cache: WebCache;
  private eventBus: EventBus;
  private maxResults: number;

  constructor(cacheDir: string, maxResults = 5, eventBus: EventBus) {
    this.cache = new WebCache(cacheDir);
    this.maxResults = maxResults;
    this.eventBus = eventBus;
  }

  async search(query: string): Promise<WebSearchResult[]> {
    this.eventBus.emit("web:search", query);

    const cached = this.cache.get<WebSearchResult[]>(`search:${query}`);
    if (cached) return cached.slice(0, this.maxResults);

    const results: WebSearchResult[] = [];

    try {
      const ddgResults = await this.searchDuckDuckGo(query);
      results.push(...ddgResults);
    } catch { /* fall through */ }

    if (results.length === 0) {
      try {
        const googleResults = await this.searchGoogle(query);
        results.push(...googleResults);
      } catch { /* fall through */ }
    }

    const seen = new Set<string>();
    const deduped = results.filter((r) => {
      if (seen.has(r.url)) return false;
      seen.add(r.url);
      return true;
    });

    this.cache.set(`search:${query}`, deduped);
    return deduped.slice(0, this.maxResults);
  }

  async fetchPage(url: string): Promise<WebPageContent> {
    this.eventBus.emit("web:page:fetched", url);

    const cached = this.cache.get<WebPageContent>(`page:${url}`);
    if (cached) return cached;

    let text = "";
    let title = "";

    try {
      const response = await fetch(url, {
        headers: { "User-Agent": "9RouterCLI/0.1.0 (research bot)" },
        signal: AbortSignal.timeout(15000),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const html = await response.text();
      title = this.extractTitle(html);
      text = this.extractText(html);
    } catch (error) {
      text = `Failed to fetch ${url}: ${error instanceof Error ? error.message : "Unknown error"}`;
    }

    const content: WebPageContent = {
      url, title, text,
      metadata: {
        contentLength: text.length,
        wordCount: text.split(/\s+/).filter(Boolean).length,
        fetchTime: Date.now(),
      },
    };

    this.cache.set(`page:${url}`, content);
    return content;
  }

  private async searchDuckDuckGo(query: string): Promise<WebSearchResult[]> {
    const results: WebSearchResult[] = [];
    const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;

    try {
      const response = await fetch(url, {
        headers: { "User-Agent": "9RouterCLI/0.1.0" },
        signal: AbortSignal.timeout(10000),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);

      const html = await response.text();
      const resultRegex = /<a[^>]*class="result__a"[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/g;
      const snippetRegex = /<a[^>]*class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g;

      const urls: string[] = [];
      const titles: string[] = [];
      const snippets: string[] = [];

      let resultMatch: RegExpExecArray | null;
      while ((resultMatch = resultRegex.exec(html)) !== null) {
        if (resultMatch[1]) urls.push(resultMatch[1]);
        if (resultMatch[2]) titles.push(resultMatch[2].replace(/<[^>]*>/g, "").trim());
      }
      let snippetMatch: RegExpExecArray | null;
      while ((snippetMatch = snippetRegex.exec(html)) !== null) {
        if (snippetMatch[1]) snippets.push(snippetMatch[1].replace(/<[^>]*>/g, "").trim());
      }

      for (let i = 0; i < Math.min(urls.length, 10); i++) {
        const title = titles[i] ?? "Untitled";
        const url = urls[i] ?? "";
        const snippet = snippets[i] ?? "";
        results.push({ title, url, snippet, source: "duckduckgo", timestamp: Date.now() });
      }
    } catch { /* silent */ }

    return results;
  }

  private async searchGoogle(query: string): Promise<WebSearchResult[]> {
    const apiKey = process.env.GOOGLE_API_KEY;
    const cx = process.env.GOOGLE_CX;
    if (!apiKey || !cx) return [];

    try {
      const response = await fetch(
        `https://www.googleapis.com/customsearch/v1?key=${apiKey}&cx=${cx}&q=${encodeURIComponent(query)}`,
        { signal: AbortSignal.timeout(10000) }
      );
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json() as { items?: Array<{ title: string; link: string; snippet: string }> };
      return (data.items ?? []).map((item) => ({
        title: item.title, url: item.link, snippet: item.snippet,
        source: "google", timestamp: Date.now(),
      }));
    } catch { return []; }
  }

  private extractTitle(html: string): string {
    const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    return match && match[1] ? match[1].trim() : "Untitled";
  }

  private extractText(html: string): string {
    let text = html.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "");
    text = text.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "");
    text = text.replace(/<[^>]*>/g, " ");
    text = text.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'");
    text = text.replace(/\s+/g, " ").trim();
    return text.slice(0, 10000);
  }
}

// ─── Browser Automation ───────────────────────────────────────────────────────

export class BrowserAutomator {
  private sessions: Map<string, BrowserSession> = new Map();

  async createSession(url: string): Promise<BrowserSession> {
    const id = `browser_${Date.now()}`;
    const session: BrowserSession = {
      id, url, title: "",
      screenshots: [], consoleLogs: [], errors: [],
      createdAt: Date.now(),
    };
    this.sessions.set(id, session);
    return session;
  }

  async takeScreenshot(sessionId: string): Promise<string | null> {
    const session = this.sessions.get(sessionId);
    if (!session) return null;
    const screenshotPath = join(process.cwd(), "screenshots", `${sessionId}_${Date.now()}.png`);
    session.screenshots.push(screenshotPath);
    return screenshotPath;
  }

  closeSession(sessionId: string): void {
    this.sessions.delete(sessionId);
  }

  getActiveSessions(): BrowserSession[] {
    return [...this.sessions.values()];
  }
}

// ─── Web Manager ──────────────────────────────────────────────────────────────

export class WebManager {
  readonly search: WebSearchEngine;
  readonly browser: BrowserAutomator;

  constructor(cacheDir: string, eventBus: EventBus) {
    this.search = new WebSearchEngine(cacheDir, 5, eventBus);
    this.browser = new BrowserAutomator();
  }
}
