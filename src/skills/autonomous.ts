/**
 * 9 Router CLI — Autonomous Skill Creation Engine
 *
 * Inspired by Hermes Agent's self-improving skill system:
 * - Creates skills from experience during use
 * - Self-improving skills that evolve with usage
 * - Experience recording and pattern detection
 * - agentskills.io compatible skill format
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync as _fsReaddirSync } from "fs";
import { join } from "path";
import { EventBus } from "../core/events";
import type { SkillDefinition, SkillCategory, RequiredCapability } from "../skills/types";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ExperienceRecord {
  id: string;
  timestamp: number;
  userMessage: string;
  assistantResponse: string;
  toolsUsed: string[];
  success: boolean;
  duration: number;
  tokensUsed: number;
  tags: string[];
}

export interface SkillPattern {
  id: string;
  name: string;
  trigger: string; // Pattern in user messages
  response: string; // Template for response
  confidence: number;
  usageCount: number;
  successRate: number;
  createdAt: number;
  lastUsed: number;
}

export interface GeneratedSkill {
  definition: SkillDefinition;
  pattern: SkillPattern;
  experiences: ExperienceRecord[];
}

// ─── Experience Recorder ──────────────────────────────────────────────────────

export class ExperienceRecorder {
  private experiences: ExperienceRecord[] = [];
  private storagePath: string;
  private maxExperiences = 1000;

  constructor(storagePath: string) {
    this.storagePath = join(storagePath, "experiences.json");
    this.load();
  }

  private load(): void {
    try {
      if (existsSync(this.storagePath)) {
        this.experiences = JSON.parse(readFileSync(this.storagePath, "utf-8"));
      }
    } catch { this.experiences = []; }
  }

  private save(): void {
    try {
      const dir = this.storagePath.split("/").slice(0, -1).join("/") || ".";
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
      writeFileSync(this.storagePath, JSON.stringify(this.experiences.slice(-this.maxExperiences)));
    } catch { /* silent */ }
  }

  /** Record an experience from a conversation turn */
  record(experience: ExperienceRecord): void {
    this.experiences.push(experience);
    if (this.experiences.length > this.maxExperiences) {
      this.experiences = this.experiences.slice(-this.maxExperiences);
    }
    this.save();
  }

  /** Find experiences matching a pattern */
  findMatching(pattern: string, limit = 10): ExperienceRecord[] {
    const term = pattern.toLowerCase();
    return this.experiences
      .filter((e) => e.userMessage.toLowerCase().includes(term) || e.tags.some((t) => t.includes(term)))
      .sort((a, b) => b.timestamp - a.timestamp)
      .slice(0, limit);
  }

  /** Get frequent patterns for skill creation */
  detectPatterns(): Array<{ trigger: string; count: number; examples: ExperienceRecord[] }> {
    // Group similar user messages by extracting common keywords
    const keywordGroups = new Map<string, ExperienceRecord[]>();

    for (const exp of this.experiences.filter((e) => e.success)) {
      // Extract key nouns/verbs from user message (simple heuristic)
      const words = exp.userMessage.toLowerCase().split(/\W+/).filter((w) => w.length > 3);
      const significant = words.filter((w) => !["this", "that", "with", "from", "have", "been", "what", "when", "where", "which"].includes(w));

      for (const word of significant) {
        const group = keywordGroups.get(word) ?? [];
        group.push(exp);
        keywordGroups.set(word, group);
      }
    }

    // Find patterns that occur frequently enough to warrant a skill
    return [...keywordGroups.entries()]
      .filter(([, exps]) => exps.length >= 3) // At least 3 occurrences
      .map(([trigger, exps]) => ({ trigger, count: exps.length, examples: exps.slice(0, 3) }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);
  }

  /** Get all experiences */
  getAll(): ExperienceRecord[] {
    return [...this.experiences];
  }

  /** Get experience count */
  get count(): number {
    return this.experiences.length;
  }
}

// ─── Skill Generator ──────────────────────────────────────────────────────────

export class SkillGenerator {
  private skillsDir: string;
  private eventBus: EventBus;

  constructor(skillsDir: string, eventBus: EventBus) {
    this.skillsDir = skillsDir;
    this.eventBus = eventBus;
    if (!existsSync(skillsDir)) mkdirSync(skillsDir, { recursive: true });
  }

  /** Generate a skill from a detected pattern */
  async generateFromPattern(
    pattern: { trigger: string; count: number; examples: ExperienceRecord[] }
  ): Promise<GeneratedSkill | null> {
    const skillId = `auto_${pattern.trigger.replace(/[^a-z0-9]/g, "_")}_${Date.now()}`;
    const skillName = this.toSkillName(pattern.trigger);

    // Build the skill definition
    const definition: SkillDefinition = {
      id: skillId,
      name: skillName,
      version: "1.0.0",
      description: `Automatically generated skill for handling "${pattern.trigger}" related requests`,
      category: "custom" as SkillCategory,
      entry: join(this.skillsDir, `${skillId}.skill`),
      requiredCapabilities: [] as RequiredCapability[],
    };

    // Build the skill pattern
    const skillPattern: SkillPattern = {
      id: pattern.trigger,
      name: skillName,
      trigger: pattern.trigger,
      response: this.generateResponseTemplate(pattern.examples[0]!),
      confidence: Math.min(pattern.count / 10, 1),
      usageCount: 0,
      successRate: 1.0,
      createdAt: Date.now(),
      lastUsed: Date.now(),
    };

    // Write the skill file
    const skillContent = this.generateSkillFile(definition, skillPattern, pattern.examples);
    writeFileSync(join(this.skillsDir, `${skillId}.skill`), skillContent, "utf-8");

    this.eventBus.emit("skill:created", skillId);

    return { definition, pattern: skillPattern, experiences: pattern.examples };
  }

  /** Create a manual skill definition */
  async createSkill(params: {
    name: string;
    description: string;
    category: SkillCategory;
    trigger: string;
  }): Promise<GeneratedSkill> {
    const skillId = `manual_${params.name.toLowerCase().replace(/[^a-z0-9]/g, "_")}`;

    const definition: SkillDefinition = {
      id: skillId,
      name: params.name,
      version: "1.0.0",
      description: params.description,
      category: params.category,
      entry: join(this.skillsDir, `${skillId}.skill`),
    };

    const skillPattern: SkillPattern = {
      id: params.trigger,
      name: params.name,
      trigger: params.trigger,
      response: `Skill handler for: ${params.name}`,
      confidence: 1.0,
      usageCount: 0,
      successRate: 1.0,
      createdAt: Date.now(),
      lastUsed: Date.now(),
    };

    const skillContent = JSON.stringify({ definition: { ...definition, entry: `${skillId}.skill` }, pattern: skillPattern }, null, 2);
    writeFileSync(join(this.skillsDir, `${skillId}.skill`), skillContent, "utf-8");

    this.eventBus.emit("skill:created", skillId);

    return { definition, pattern: skillPattern, experiences: [] };
  }

  /** List all auto-generated skills */
  listGeneratedSkills(): GeneratedSkill[] {
    const skills: GeneratedSkill[] = [];
    try {
      if (!existsSync(this.skillsDir)) return [];
      const files = _fsReaddirSync(this.skillsDir).filter((f) => f.endsWith(".skill"));
      for (const file of files) {
        try {
          const content = JSON.parse(readFileSync(join(this.skillsDir, file), "utf-8"));
          skills.push(content);
        } catch { /* skip invalid */ }
      }
    } catch { /* silent */ }
    return skills;
  }

  private toSkillName(trigger: string): string {
    return trigger
      .split(/[^a-z0-9]/i)
      .filter(Boolean)
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join("");
  }

  private generateResponseTemplate(example: ExperienceRecord): string {
    return example.assistantResponse.slice(0, 200);
  }

  private generateSkillFile(definition: SkillDefinition, pattern: SkillPattern, examples: ExperienceRecord[]): string {
    return JSON.stringify({
      definition: { ...definition, entry: `${definition.id}.skill` },
      pattern,
      examples: examples.map((e) => ({
        user: e.userMessage.slice(0, 100),
        assistant: e.assistantResponse.slice(0, 100),
        tools: e.toolsUsed,
        success: e.success,
      })),
    }, null, 2);
  }
}

// ─── Autonomous Skill Manager ─────────────────────────────────────────────────

export class AutonomousSkillManager {
  readonly recorder: ExperienceRecorder;
  readonly generator: SkillGenerator;
  private activePatterns: Map<string, SkillPattern> = new Map();
  private eventBus: EventBus;

  constructor(skillsDir: string, eventBus: EventBus) {
    this.eventBus = eventBus;
    this.recorder = new ExperienceRecorder(skillsDir);
    this.generator = new SkillGenerator(skillsDir, eventBus);
  }

  /** Record a conversation turn as experience */
  async recordExperience(userMsg: string, assistantResponse: string, toolsUsed: string[], success: boolean, tokensUsed: number): Promise<void> {
    const record: ExperienceRecord = {
      id: `exp_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      timestamp: Date.now(),
      userMessage: userMsg,
      assistantResponse,
      toolsUsed,
      success,
      duration: 0,
      tokensUsed,
      tags: this.extractTags(userMsg),
    };

    this.recorder.record(record);
    this.eventBus.emit("skill:experience:recorded", record.tags.join(","));

    // Check if we should generate a new skill
    if (this.recorder.count % 10 === 0) { // Check every 10 experiences
      const patterns = this.recorder.detectPatterns();
      for (const pattern of patterns) {
        if (!this.activePatterns.has(pattern.trigger) && pattern.count >= 3) {
          const generated = await this.generator.generateFromPattern(pattern);
          if (generated) {
            this.activePatterns.set(generated.pattern.id, generated.pattern);
          }
        }
      }
    }
  }

  /** Get active skill patterns */
  getActivePatterns(): SkillPattern[] {
    return [...this.activePatterns.values()];
  }

  /** Find a matching skill for a user message */
  findMatchingSkill(userMessage: string): SkillPattern | null {
    const lower = userMessage.toLowerCase();
    for (const pattern of this.activePatterns.values()) {
      if (lower.includes(pattern.trigger)) {
        pattern.usageCount++;
        pattern.lastUsed = Date.now();
        return pattern;
      }
    }
    return null;
  }

  /** Check for skill evolution opportunities */
  async checkEvolution(): Promise<GeneratedSkill[]> {
    const patterns = this.recorder.detectPatterns();
    const newSkills: GeneratedSkill[] = [];

    for (const pattern of patterns) {
      if (!this.activePatterns.has(pattern.trigger) && pattern.count >= 3) {
        const generated = await this.generator.generateFromPattern(pattern);
        if (generated) {
          this.activePatterns.set(generated.pattern.id, generated.pattern);
          newSkills.push(generated);
        }
      }
    }

    return newSkills;
  }

  private extractTags(message: string): string[] {
    const tags: string[] = [];

    if (message.includes("```")) tags.push("code");
    if (/\b(explain|what|how|why|when)\b/.test(message)) tags.push("question");
    if (/\b(create|make|build|generate|write)\b/.test(message)) tags.push("generation");
    if (/\b(fix|bug|error|issue|problem)\b/.test(message)) tags.push("debug");
    if (/\b(refactor|improve|optimize|clean)\b/.test(message)) tags.push("refactor");
    if (/\b(deploy|release|publish)\b/.test(message)) tags.push("deploy");
    if (/\b(test|spec|unit|integration)\b/.test(message)) tags.push("testing");

    return tags;
  }
}


