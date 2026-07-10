/**
 * 9 Router CLI — Personas & TUI System
 *
 * Inspired by Hermes Agent's personality system and TUI:
 * - Personality profiles with configurable traits
 * - Reasoning effort control (low/medium/high)
 * - Multiline editing support for the input prompt
 * - Persona-aware response formatting
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import chalk from "chalk";
import { EventBus } from "../core/events";

// ─── Types ────────────────────────────────────────────────────────────────────

export type ReasoningEffort = "low" | "medium" | "high";

export interface Persona {
  id: string;
  name: string;
  description: string;
  traits: PersonaTrait[];
  systemPromptSuffix: string;
  temperature: number;
  responseStyle: "concise" | "balanced" | "detailed" | "creative";
  color: string;
}

export interface PersonaTrait {
  name: string;
  weight: number; // 0-1
  description: string;
}

// ─── Persona Definitions ──────────────────────────────────────────────────────

const BUILTIN_PERSONAS: Persona[] = [
  {
    id: "default",
    name: "Default Assistant",
    description: "Balanced, professional AI assistant",
    traits: [
      { name: "helpful", weight: 1.0, description: "Always tries to help" },
      { name: "professional", weight: 0.8, description: "Maintains professional tone" },
    ],
    systemPromptSuffix: "",
    temperature: 0.7,
    responseStyle: "balanced",
    color: "#64B5F6",
  },
  {
    id: "professional",
    name: "Professional",
    description: "Formal, precise, and business-oriented",
    traits: [
      { name: "precise", weight: 1.0, description: "Gives precise answers" },
      { name: "formal", weight: 0.9, description: "Uses formal language" },
      { name: "structured", weight: 0.8, description: "Prefers structured responses" },
    ],
    systemPromptSuffix: "\nRespond in a professional, formal tone. Be precise and well-structured. Avoid casual language.",
    temperature: 0.5,
    responseStyle: "detailed",
    color: "#4CAF50",
  },
  {
    id: "creative",
    name: "Creative",
    description: "Imaginative and exploratory",
    traits: [
      { name: "creative", weight: 1.0, description: "Thinks creatively" },
      { name: "exploratory", weight: 0.8, description: "Explores multiple angles" },
      { name: "expressive", weight: 0.7, description: "Uses expressive language" },
    ],
    systemPromptSuffix: "\nBe creative and imaginative. Feel free to explore ideas and use expressive language. Think outside the box.",
    temperature: 0.9,
    responseStyle: "creative",
    color: "#FF7597",
  },
  {
    id: "concise",
    name: "Concise",
    description: "Short, direct, to-the-point answers",
    traits: [
      { name: "direct", weight: 1.0, description: "Gives direct answers" },
      { name: "minimal", weight: 0.9, description: "Uses minimal words" },
    ],
    systemPromptSuffix: "\nBe extremely concise. Use short sentences. Get straight to the point. No fluff.",
    temperature: 0.3,
    responseStyle: "concise",
    color: "#FFB74D",
  },
  {
    id: "teacher",
    name: "Teacher",
    description: "Educational, explains concepts thoroughly",
    traits: [
      { name: "educational", weight: 1.0, description: "Teaches concepts" },
      { name: "patient", weight: 0.9, description: "Takes time to explain" },
      { name: "encouraging", weight: 0.7, description: "Encourages learning" },
    ],
    systemPromptSuffix: "\nExplain concepts as if teaching a student. Break down complex ideas. Use examples. Be patient and encouraging.",
    temperature: 0.6,
    responseStyle: "detailed",
    color: "#C792EA",
  },
  {
    id: "engineer",
    name: "Engineer",
    description: "Technical, code-focused, pragmatic",
    traits: [
      { name: "technical", weight: 1.0, description: "Focuses on technical details" },
      { name: "pragmatic", weight: 0.9, description: "Gives practical solutions" },
      { name: "code-oriented", weight: 0.8, description: "Prefers showing code" },
    ],
    systemPromptSuffix: "\nFocus on technical accuracy. Provide code examples when relevant. Be practical and solution-oriented.",
    temperature: 0.4,
    responseStyle: "balanced",
    color: "#82AAFF",
  },
  {
    id: "philosopher",
    name: "Philosopher",
    description: "Contemplative, explores deeper meaning and implications",
    traits: [
      { name: "contemplative", weight: 1.0, description: "Thinks deeply" },
      { name: "thoughtful", weight: 0.9, description: "Considers implications" },
      { name: "questioning", weight: 0.7, description: "Asks deeper questions" },
    ],
    systemPromptSuffix: "\nExplore the deeper meaning and implications. Consider multiple philosophical perspectives. Be contemplative.",
    temperature: 0.85,
    responseStyle: "detailed",
    color: "#9E9E9E",
  },
  {
    id: "hype",
    name: "Hype",
    description: "Enthusiastic, motivating, energetic",
    traits: [
      { name: "enthusiastic", weight: 1.0, description: "Highly energetic" },
      { name: "motivating", weight: 0.9, description: "Motivates the user" },
      { name: "positive", weight: 0.8, description: "Maintains positive tone" },
    ],
    systemPromptSuffix: "\nBe SUPER enthusiastic! Use exclamation points! Get the user excited about what they're doing! 🚀",
    temperature: 0.95,
    responseStyle: "creative",
    color: "#FF5370",
  },
];

// ─── Persona Manager ─────────────────────────────────────────────────────────

export class PersonaManager {
  private personas: Map<string, Persona> = new Map();
  private currentPersonaId: string = "default";
  private currentEffort: ReasoningEffort = "medium";
  private storagePath: string;
  private eventBus: EventBus;

  constructor(storagePath: string, eventBus: EventBus) {
    this.storagePath = join(storagePath, "persona-state.json");
    this.eventBus = eventBus;
    for (const p of BUILTIN_PERSONAS) this.personas.set(p.id, p);
    this.load();
  }

  private load(): void {
    try {
      if (existsSync(this.storagePath)) {
        const data = JSON.parse(readFileSync(this.storagePath, "utf-8"));
        if (data.currentPersonaId && this.personas.has(data.currentPersonaId)) {
          this.currentPersonaId = data.currentPersonaId;
        }
        if (data.currentEffort) {
          this.currentEffort = data.currentEffort;
        }
      }
    } catch { /* use defaults */ }
  }

  private save(): void {
    try {
      const dir = this.storagePath.split("/").slice(0, -1).join("/") || ".";
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
      writeFileSync(this.storagePath, JSON.stringify({
        currentPersonaId: this.currentPersonaId,
        currentEffort: this.currentEffort,
      }));
    } catch { /* silent */ }
  }

  /** Get current persona */
  getCurrentPersona(): Persona {
    return this.personas.get(this.currentPersonaId) ?? this.personas.get("default")!;
  }

  /** Set current persona */
  setPersona(id: string): boolean {
    if (!this.personas.has(id)) return false;
    this.currentPersonaId = id;
    this.eventBus.emit("persona:changed", id);
    this.save();
    return true;
  }

  /** Get a persona by ID */
  getPersona(id: string): Persona | undefined {
    return this.personas.get(id);
  }

  /** List all available personas */
  listPersonas(): Persona[] {
    return [...this.personas.values()];
  }

  /** Register a custom persona */
  registerPersona(persona: Persona): void {
    this.personas.set(persona.id, persona);
  }

  /** Get current reasoning effort */
  getEffort(): ReasoningEffort {
    return this.currentEffort;
  }

  /** Set reasoning effort */
  setEffort(effort: ReasoningEffort): void {
    this.currentEffort = effort;
    this.eventBus.emit("reasoning:effort:changed", effort);
    this.save();
  }

  /** Get the system prompt suffix for the current persona+effort */
  getSystemPromptSuffix(): string {
    const persona = this.getCurrentPersona();
    let suffix = persona.systemPromptSuffix;

    // Add reasoning effort directive
    switch (this.currentEffort) {
      case "low":
        suffix += "\nKeep responses short and direct. Use minimal reasoning steps.";
        break;
      case "high":
        suffix += "\nThink through the problem step by step. Show your reasoning. Be thorough.";
        break;
      default: // medium — no additional directive
        break;
    }

    return suffix;
  }

  /** Get the temperature for the current persona+effort */
  getTemperature(): number {
    const base = this.getCurrentPersona().temperature;
    switch (this.currentEffort) {
      case "low": return Math.min(base * 0.7, 0.5);
      case "high": return Math.min(base * 1.2, 1.0);
      default: return base;
    }
  }

  /** Format a message with persona styling */
  formatMessage(message: string): string {
    const persona = this.getCurrentPersona();
    const color = chalk.hex(persona.color);
    return color(message);
  }

  /** Format a header for the current persona */
  formatHeader(): string {
    const persona = this.getCurrentPersona();
    return `${chalk.hex(persona.color).bold(persona.name)} ${chalk.dim(`(${this.currentEffort} effort)`)}`;
  }
}

// ─── Input Editor (Multiline Support) ─────────────────────────────────────────

export class MultilineEditor {
  private buffer: string[] = [];
  private active = false;

  /** Start multiline input mode */
  start(): void {
    this.active = true;
    this.buffer = [];
    console.log(chalk.dim("  ── Multiline mode (type /end to finish, /cancel to cancel) ──"));
  }

  /** Add a line to the buffer */
  addLine(line: string): void {
    if (!this.active) {
      this.start();
    }
    this.buffer.push(line);
  }

  /** Check if the input completes multiline mode */
  checkComplete(input: string): boolean {
    if (input === "/end") {
      this.active = false;
      return true;
    }
    if (input === "/cancel") {
      this.buffer = [];
      this.active = false;
      return true;
    }
    this.buffer.push(input);
    return false;
  }

  /** Get the full multiline input */
  getFullInput(): string {
    const result = this.buffer.join("\n");
    this.buffer = [];
    return result;
  }

  /** Check if multiline mode is active */
  isActive(): boolean {
    return this.active;
  }

  /** Cancel multiline input */
  cancel(): void {
    this.buffer = [];
    this.active = false;
  }
}
