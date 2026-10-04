import { ModelInfo } from '../models';

export interface ScoredModel {
  model: ModelInfo;
  score: number;
}

/**
 * Computes a fuzzy match score for needle against haystack.
 * Returns score > 0 if matched, 0 if no match.
 */
export function scoreFuzzy(haystack: string, needle: string): number {
  const h = haystack.toLowerCase();
  const n = needle.toLowerCase().trim();
  if (!n) return 1;
  if (!h) return 0;

  // Exact match
  if (h === n) return 10000;

  // Starts with
  if (h.startsWith(n)) return 5000 + Math.max(0, 500 - (h.length - n.length));

  // Word boundary match (e.g. "sonnet" in "cc/claude-3-7-sonnet" or "claude sonnet")
  const wordBoundaryRegex = new RegExp(`(?:^|[\\W_])${escapeRegex(n)}`, 'i');
  if (wordBoundaryRegex.test(h)) return 3500 + Math.max(0, 300 - (h.length - n.length));

  // Substring match
  const subIdx = h.indexOf(n);
  if (subIdx >= 0) return 2500 - subIdx * 5;

  // Subsequence match (characters appear in order)
  let score = 0;
  let hIdx = 0;
  let prevMatchIdx = -2;
  let consecutive = 0;

  for (let nIdx = 0; nIdx < n.length; nIdx++) {
    const char = n[nIdx];
    const foundIdx = h.indexOf(char, hIdx);
    if (foundIdx === -1) return 0; // Not a subsequence match

    score += 10;
    if (foundIdx === prevMatchIdx + 1) {
      consecutive++;
      score += consecutive * 15; // Bonus for consecutive matched characters
    } else {
      consecutive = 0;
      score -= (foundIdx - prevMatchIdx) * 2; // Penalty for gaps
    }

    // Word start bonus
    if (foundIdx === 0 || /[\W_]/.test(h[foundIdx - 1])) {
      score += 25;
    }

    prevMatchIdx = foundIdx;
    hIdx = foundIdx + 1;
  }

  return Math.max(1, score);
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const PROVIDER_ALIASES: Record<string, string[]> = {
  ag: ['antigravity', 'google antigravity', 'ag'],
  cc: ['claude code', 'anthropic', 'claude', 'cc'],
  cx: ['openai codex', 'codex', 'openai', 'cx'],
  gc: ['gemini cli', 'google gemini', 'google', 'gc'],
  gh: ['github copilot', 'copilot', 'gh'],
  kr: ['kiro ai', 'kiro', 'kr'],
  if: ['iflow ai', 'iflow', 'if'],
  qw: ['qwen code', 'alibaba qwen', 'qw'],
  glm: ['glm coding', 'zhipu glm', 'glm'],
  kimi: ['kimi coding', 'moonshot kimi', 'kimi'],
  minimax: ['minimax coding', 'minimax'],
  openrouter: ['openrouter', 'or'],
  freemodel: ['freemodel', 'free model', 'free'],
  blueminds: ['blueminds'],
  cf: ['cloudflare', 'cloudflare ai', 'cf'],
  cu: ['cursor', 'cu'],
  kc: ['kimchi code', 'kc'],
  kimchi: ['kimchi']
};

function getModelFamilyKeywords(id: string): string[] {
  const lower = id.toLowerCase();
  const kw: string[] = [];
  if (lower.includes('claude') || lower.includes('sonnet') || lower.includes('opus') || lower.includes('haiku') || lower.includes('fable')) {
    kw.push('anthropic', 'claude');
  }
  if (lower.includes('gemini') || lower.includes('gemma')) {
    kw.push('google', 'gemini');
  }
  if (lower.includes('gpt') || lower.includes('chatgpt') || /\bo[1-9]\b/.test(lower) || lower.includes('codex') || lower.includes('astra')) {
    kw.push('openai', 'gpt');
  }
  if (lower.includes('deepseek')) {
    kw.push('deepseek');
  }
  if (lower.includes('qwen')) {
    kw.push('alibaba', 'qwen');
  }
  if (lower.includes('llama')) {
    kw.push('meta', 'llama');
  }
  if (lower.includes('mistral') || lower.includes('codestral')) {
    kw.push('mistral');
  }
  if (lower.includes('kimi')) {
    kw.push('moonshot', 'kimi');
  }
  if (lower.includes('minimax')) {
    kw.push('minimax');
  }
  if (lower.includes('grok')) {
    kw.push('xai', 'grok');
  }
  if (lower.includes('command')) {
    kw.push('cohere');
  }
  return kw;
}

/**
 * Searches across the complete 9 Router model list (ID, provider, caps, tags)
 * using weighted fuzzy search.
 */
export function searchModels(query: string, models: ModelInfo[]): ModelInfo[] {
  const q = query.trim().toLowerCase();
  if (!q) {
    // When no query is provided, return all models, prioritizing 9 Router live models
    return [...models].sort((a, b) => {
      const aRouter = a.source === 'router' || a.id.includes('/');
      const bRouter = b.source === 'router' || b.id.includes('/');
      if (aRouter !== bRouter) return aRouter ? -1 : 1;
      return a.id.localeCompare(b.id);
    });
  }

  const queryTerms = q.split(/\s+/).filter(Boolean);
  const scored: ScoredModel[] = [];

  for (const model of models) {
    let totalScore = 0;
    let allTermsMatched = true;

    // Search against multiple dimensions:
    // 1. Model ID & Base ID (primary weight: 2.2 / 2.0)
    // 2. Provider name & provider aliases (weight: 1.5)
    // 3. Capabilities & model family keywords (weight: 1.2)
    const id = model.id;
    const baseId = id.includes('/') ? id.slice(id.indexOf('/') + 1) : id;
    const prefix = id.includes('/') ? id.slice(0, id.indexOf('/')) : '';
    const provider = model.provider || prefix || '';

    const aliases = PROVIDER_ALIASES[provider.toLowerCase()] || [];
    const familyKeywords = getModelFamilyKeywords(id);

    const capsTags: string[] = [...familyKeywords, ...aliases];
    if (prefix) capsTags.push(prefix);
    if (model.caps.tools) capsTags.push('tools', 'tool', 'function_calling');
    if (model.caps.reasoning) capsTags.push('reasoning', 'thinking');
    if (model.caps.vision) capsTags.push('vision', 'multimodal');
    if (model.caps.audioInput || model.caps.audioOutput) capsTags.push('audio', 'voice', 'speech');
    if (model.live) capsTags.push('live', 'voice-to-voice');
    const capsText = capsTags.join(' ');

    for (const term of queryTerms) {
      const fullIdScore = scoreFuzzy(id, term) * 2.2;
      const baseIdScore = scoreFuzzy(baseId, term) * 2.0;
      const idScore = Math.max(fullIdScore, baseIdScore);

      let provScore = scoreFuzzy(provider, term) * 1.5;
      for (const alias of aliases) {
        provScore = Math.max(provScore, scoreFuzzy(alias, term) * 1.5);
      }

      const capsScore = scoreFuzzy(capsText, term) * 1.2;

      const maxTermScore = Math.max(idScore, provScore, capsScore);
      if (maxTermScore <= 0) {
        allTermsMatched = false;
        break;
      }
      totalScore += maxTermScore;
    }

    if (allTermsMatched && totalScore > 0) {
      // Bonus for 9 Router models
      if (model.source === 'router' || model.id.includes('/')) totalScore += 25;
      scored.push({ model, score: totalScore });
    }
  }

  // Sort descending by score, tie-break by ID length and alphabet
  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    if (a.model.id.length !== b.model.id.length) return a.model.id.length - b.model.id.length;
    return a.model.id.localeCompare(b.model.id);
  });

  return scored.map((s) => s.model);
}
