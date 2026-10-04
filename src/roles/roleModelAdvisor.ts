import { ModelInfo, UnifiedModelCatalog } from '../models';
import { RoleDefinition } from './types';
import { searchModels } from './fuzzySearch';

export type AssignmentStrategy = 'quality' | 'balanced' | 'cost_efficient';

export interface ModelRecommendation {
  roleId: string;
  roleName: string;
  previousPrimary: string;
  newPrimary: string;
  previousFallbacks: string[];
  newFallbacks: string[];
  reason: string;
}

export interface AutoAssignResult {
  strategy: AssignmentStrategy;
  timestamp: number;
  totalRoles: number;
  rolesModified: number;
  recommendations: ModelRecommendation[];
  summary: string;
}

interface RoleArchetype {
  preferredPatterns: string[];
  fallbackPatterns: string[];
  requiredCapabilities: Array<'tools' | 'reasoning' | 'vision'>;
  primaryRationale: string;
}

const ROLE_ARCHETYPES: Record<string, RoleArchetype> = {
  researcher: {
    preferredPatterns: ['claude-opus-4-6-thinking', 'claude-fable-5', 'claude-sonnet-4-6', 'gemini-3.6-flash-high', 'claude-3-7-sonnet', 'gpt-4o'],
    fallbackPatterns: ['claude-fable-5', 'gemini-3.6-flash-high', 'deepseek-v4-flash', 'gpt-4o'],
    requiredCapabilities: ['reasoning'],
    primaryRationale: 'High reasoning capability, massive context window, and superior synthesis of architectural patterns.'
  },
  backend: {
    preferredPatterns: ['qwen3-coder-next', 'claude-sonnet-4-6', 'deepseek-v4-flash', 'gpt-5.3-codex', 'claude-3-7-sonnet', 'gpt-4o'],
    fallbackPatterns: ['claude-sonnet-4-6', 'deepseek-v4-flash', 'gpt-4o', 'gemini-3.6-flash'],
    requiredCapabilities: ['tools'],
    primaryRationale: 'Premier deterministic code generation, complex refactoring, and accurate tool/API usage.'
  },
  frontend: {
    preferredPatterns: ['claude-sonnet-4-6', 'claude-4.5-sonnet', 'qwen3-coder-next', 'minimaxai/minimax-m3', 'gpt-4o'],
    fallbackPatterns: ['qwen3-coder-next', 'minimaxai/minimax-m3', 'gpt-4o', 'claude-haiku-4-5-20251001'],
    requiredCapabilities: ['tools'],
    primaryRationale: 'Flawless component hierarchy, modern reactive state patterns, and responsive CSS styling.'
  },
  database: {
    preferredPatterns: ['deepseek-v4-flash', 'deepseek-3.2-thinking', 'qwen3-coder-next', 'claude-sonnet-4-6', 'gpt-4o'],
    fallbackPatterns: ['qwen3-coder-next', 'claude-sonnet-4-6', 'gpt-4o', 'gemini-3.6-flash'],
    requiredCapabilities: ['reasoning'],
    primaryRationale: 'Rigorous relational modeling, ACID schema migrations, and high-performance SQL query construction.'
  },
  api: {
    preferredPatterns: ['qwen3-coder-next', 'claude-sonnet-4-6', 'deepseek-v4-flash', 'gpt-4o'],
    fallbackPatterns: ['claude-sonnet-4-6', 'deepseek-v4-flash', 'gpt-4o', 'minimaxai/minimax-m3'],
    requiredCapabilities: ['tools'],
    primaryRationale: 'Type-safe RPC and REST contract design, strict input/output validation, and error serialization.'
  },
  authentication: {
    preferredPatterns: ['claude-sonnet-4-6-thinking', 'claude-sonnet-4-6', 'claude-opus-4-6-thinking', 'gpt-4o'],
    fallbackPatterns: ['claude-opus-4-6-thinking', 'deepseek-v4-flash', 'gpt-4o', 'gemini-3.6-flash'],
    requiredCapabilities: ['reasoning'],
    primaryRationale: 'Defense-in-depth token lifecycles, cryptographic best practices, and secure authorization gates.'
  },
  security: {
    preferredPatterns: ['claude-opus-4-6-thinking', 'claude-sonnet-4-6-thinking', 'deepseek-v4-flash', 'gpt-4o'],
    fallbackPatterns: ['claude-sonnet-4-6-thinking', 'deepseek-v4-flash', 'gpt-4o'],
    requiredCapabilities: ['reasoning'],
    primaryRationale: 'Deep vulnerability discovery, injection mitigation, and static code audit precision.'
  },
  testing: {
    preferredPatterns: ['qwen3-coder-next', 'claude-sonnet-4-6', 'deepseek-v4-flash', 'minimaxai/minimax-m3'],
    fallbackPatterns: ['claude-sonnet-4-6', 'deepseek-v4-flash', 'minimaxai/minimax-m3', 'gpt-4o'],
    requiredCapabilities: ['tools'],
    primaryRationale: 'Exhaustive edge-case assertion writing, mock framework design, and regression verification.'
  },
  devops: {
    preferredPatterns: ['minimaxai/minimax-m3', 'qwen3-coder-next', 'claude-sonnet-4-6', 'gpt-4o'],
    fallbackPatterns: ['qwen3-coder-next', 'claude-sonnet-4-6', 'gpt-4o', 'deepseek-v4-flash'],
    requiredCapabilities: ['tools'],
    primaryRationale: 'Idempotent shell scripting, container build optimization, and CI/CD workflow automation.'
  },
  uiux: {
    preferredPatterns: ['claude-sonnet-4-6', 'claude-haiku-4-5-20251001', 'minimaxai/minimax-m3', 'gpt-4o'],
    fallbackPatterns: ['claude-haiku-4-5-20251001', 'minimaxai/minimax-m3', 'gpt-4o'],
    requiredCapabilities: ['vision'],
    primaryRationale: 'Visual elegance, refined color palettes, typography hierarchy, and micro-interaction design.'
  },
  documentation: {
    preferredPatterns: ['claude-fable-5', 'claude-sonnet-4-6', 'minimaxai/minimax-m3', 'gpt-4o'],
    fallbackPatterns: ['claude-sonnet-4-6', 'minimaxai/minimax-m3', 'gpt-4o'],
    requiredCapabilities: [],
    primaryRationale: 'Clear markdown authoring, comprehensive API specifications, and readable technical overviews.'
  },
  performance: {
    preferredPatterns: ['claude-opus-4-6-thinking', 'qwen3-coder-next', 'deepseek-v4-flash', 'gpt-4o'],
    fallbackPatterns: ['qwen3-coder-next', 'deepseek-v4-flash', 'gpt-4o'],
    requiredCapabilities: ['reasoning'],
    primaryRationale: 'Algorithmic complexity reduction, memory leak isolation, and latency profiling.'
  },
  code_reviewer: {
    preferredPatterns: ['claude-opus-4-6-thinking', 'claude-sonnet-4-6-thinking', 'qwen3-coder-next', 'claude-fable-5'],
    fallbackPatterns: ['claude-sonnet-4-6-thinking', 'qwen3-coder-next', 'claude-fable-5', 'gpt-4o'],
    requiredCapabilities: ['reasoning'],
    primaryRationale: 'Objective diff analysis, adherence to architecture conventions, and regression trapping.'
  }
};

/**
 * Finds the best matching model ID from active catalog given a set of priority search terms.
 * Prioritizes router-connected models (with prefixes like cc/, ag/, kr/) if present.
 */
function findBestModelMatch(terms: string[], catalog: ModelInfo[], excludeIds: Set<string>): string | undefined {
  for (const term of terms) {
    const matched = searchModels(term, catalog).filter((m) => !excludeIds.has(m.id) && !m.live);
    if (matched.length > 0) {
      // Prioritize router-specific models or exact name matches
      const routerMatch = matched.find((m) => m.source === 'router');
      return (routerMatch || matched[0]).id;
    }
  }
  return undefined;
}

/**
 * Evaluates and auto-assigns the optimal primary model and multi-provider fallback models
 * for each specialized role based on 9 Router catalog capabilities.
 */
export function autoAssignBestModelsForRoles(
  roles: RoleDefinition[],
  catalog?: ModelInfo[],
  strategy: AssignmentStrategy = 'quality'
): { updatedRoles: RoleDefinition[]; result: AutoAssignResult } {
  const activeCatalog = catalog && catalog.length > 0 ? catalog : UnifiedModelCatalog.getInstance().getModels();
  const updatedRoles: RoleDefinition[] = [];
  const recommendations: ModelRecommendation[] = [];

  for (const role of roles) {
    const archetype = ROLE_ARCHETYPES[role.id.toLowerCase()] || {
      preferredPatterns: ['claude-3-7-sonnet', 'deepseek-chat', 'gpt-4o', 'gemini-2.5-flash'],
      fallbackPatterns: ['gpt-4o', 'gemini-2.5-flash', 'deepseek-chat'],
      requiredCapabilities: ['tools'],
      primaryRationale: 'General software engineering intelligence and tool-calling execution.'
    };

    const usedModels = new Set<string>();

    // Determine primary model
    let primary = findBestModelMatch(archetype.preferredPatterns, activeCatalog, usedModels);
    if (!primary) {
      primary = role.primaryModel || 'cc/claude-3-7-sonnet';
    }
    usedModels.add(primary);

    // Determine fallbacks (2 to 3 distinct models across diverse providers)
    const fallbacks: string[] = [];
    for (const pattern of archetype.fallbackPatterns) {
      if (fallbacks.length >= 3) break;
      const fb = findBestModelMatch([pattern], activeCatalog, usedModels);
      if (fb && !usedModels.has(fb)) {
        fallbacks.push(fb);
        usedModels.add(fb);
      }
    }

    if (fallbacks.length === 0 && role.fallbackModels && role.fallbackModels.length > 0) {
      for (const fb of role.fallbackModels) {
        if (!usedModels.has(fb)) {
          fallbacks.push(fb);
          usedModels.add(fb);
        }
      }
    }

    const primaryChanged = primary !== role.primaryModel;
    const fallbacksChanged = JSON.stringify(fallbacks) !== JSON.stringify(role.fallbackModels);

    const updatedRole: RoleDefinition = {
      ...role,
      primaryModel: primary,
      fallbackModels: fallbacks.length > 0 ? fallbacks : role.fallbackModels
    };

    updatedRoles.push(updatedRole);

    recommendations.push({
      roleId: role.id,
      roleName: role.name,
      previousPrimary: role.primaryModel,
      newPrimary: primary,
      previousFallbacks: role.fallbackModels || [],
      newFallbacks: updatedRole.fallbackModels,
      reason: archetype.primaryRationale + (primaryChanged ? ` (Upgraded to ${primary})` : ' (Retained optimal model)')
    });
  }

  const modifiedCount = recommendations.filter(
    (r) => r.previousPrimary !== r.newPrimary || JSON.stringify(r.previousFallbacks) !== JSON.stringify(r.newFallbacks)
  ).length;

  const summary = `Successfully evaluated all ${roles.length} roles against 9 Router catalog. ${
    modifiedCount > 0 ? `Updated ${modifiedCount} role(s) with optimal models and fallback chains.` : 'All roles already aligned with optimal models.'
  }`;

  return {
    updatedRoles,
    result: {
      strategy,
      timestamp: Date.now(),
      totalRoles: roles.length,
      rolesModified: modifiedCount,
      recommendations,
      summary
    }
  };
}
