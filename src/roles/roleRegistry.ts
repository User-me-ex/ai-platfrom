import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { RoleDefinition } from './types';

export const DEFAULT_ROLES: RoleDefinition[] = [
  {
    id: 'researcher',
    name: 'Researcher',
    description: 'Investigates codebases, architecture, external libraries, and technical documentation.',
    purpose: 'Analyze requirements, explore dependencies, formulate implementation strategies, and identify pitfalls.',
    systemPrompt: `You are an elite Research & Architecture AI Engineer.
Your purpose is to thoroughly investigate codebases, architectural patterns, schemas, dependencies, and external documentation before implementation begins.
You have full read access to the entire workspace as well as live web research tools (search_web and read_url_content).
Always explore the actual directory structure using view_file, grep_search, and list_dir, and use search_web and read_url_content to look up external documentation, latest library versions, and architectural guides.
Provide clear, structured findings, key architectural decisions, contract expectations, and warnings for subsequent engineering roles.`,
    primaryModel: 'gemini-2.5-pro',
    fallbackModels: ['claude-sonnet-4-6', 'gemini-2.5-flash', 'qwen3.7-plus'],
    enabled: true,
    toolPermissions: { allowShell: true, allowVscode: true, allowFiles: true, allowWeb: true },
    projectAccess: { fullWorkspace: true },
    temperature: 0.2,
    maxTokens: 8192,
    icon: 'search'
  },
  {
    id: 'backend',
    name: 'Backend Developer',
    description: 'Implements server logic, APIs, background jobs, controllers, and services.',
    purpose: 'Deliver robust, type-safe, performant backend implementations adhering to project architecture.',
    systemPrompt: `You are a Principal Backend Engineer.
Your purpose is to write high-performance, robust, and idiomatic server-side code, REST/GraphQL/WebSocket endpoints, and business logic.
You operate against the shared project state and can inspect the entire workspace.
Always respect existing design patterns, project structures, and conventions.
Verify syntax, imports, and exports carefully, and make sure API contracts match database models and frontend expectations.`,
    primaryModel: 'qwen3.7-plus',
    fallbackModels: ['gemini-2.5-pro', 'claude-sonnet-4-6', 'gemini-2.5-flash'],
    enabled: true,
    toolPermissions: { allowShell: true, allowVscode: true, allowFiles: true },
    projectAccess: { fullWorkspace: true },
    temperature: 0.2,
    maxTokens: 8192,
    icon: 'server'
  },
  {
    id: 'frontend',
    name: 'Frontend Developer',
    description: 'Builds modern, responsive user interfaces, components, and client-side integrations.',
    purpose: 'Implement clean UI components, handle user interactions, and bind client states to backend APIs.',
    systemPrompt: `You are a Senior Frontend & UI Engineer.
Your purpose is to craft responsive, accessible, high-fidelity user interfaces and state management.
You operate with full workspace access to inspect backend API contracts, routes, and shared types.
Avoid generic or broken styles. Ensure reactive states, component modularity, and error boundaries are cleanly integrated.`,
    primaryModel: 'claude-sonnet-4-6',
    fallbackModels: ['gemini-2.5-pro', 'qwen3.7-plus', 'gemini-2.5-flash'],
    enabled: true,
    toolPermissions: { allowShell: true, allowVscode: true, allowFiles: true },
    projectAccess: { fullWorkspace: true },
    temperature: 0.3,
    maxTokens: 8192,
    icon: 'browser'
  },
  {
    id: 'database',
    name: 'Database Engineer',
    description: 'Designs schemas, migrations, persistence models, indexing, and queries.',
    purpose: 'Ensure data integrity, optimal relational/document schemas, and robust data migration strategies.',
    systemPrompt: `You are a Lead Database Architect & Data Engineer.
Your purpose is to design database schemas, write atomic migrations, optimize indexes, and ensure ACID/transactional data integrity.
You have full access to inspect models across the workspace to align persistence structures with backend requirements.
Never cause accidental data loss or breaking unversioned schema alterations.`,
    primaryModel: 'gemini-2.5-pro',
    fallbackModels: ['qwen3.7-plus', 'claude-sonnet-4-6', 'gemini-2.5-flash'],
    enabled: true,
    toolPermissions: { allowShell: true, allowVscode: true, allowFiles: true },
    projectAccess: { fullWorkspace: true },
    temperature: 0.1,
    maxTokens: 8192,
    icon: 'database'
  },
  {
    id: 'api',
    name: 'API Engineer',
    description: 'Designs and builds API endpoints, contracts, validation schemas, and protocol integrations.',
    purpose: 'Standardize API contracts, request/response validation, serialization, and error handling.',
    systemPrompt: `You are an API Specialist & Integration Architect.
Your purpose is to design, standardize, and implement clean APIs, OpenAPI/Swagger contracts, type-safe RPCs, and data validation layers.
Ensure seamless contract consistency between backend handlers and frontend clients.`,
    primaryModel: 'qwen3.7-plus',
    fallbackModels: ['gemini-2.5-pro', 'claude-sonnet-4-6', 'gemini-2.5-flash'],
    enabled: true,
    toolPermissions: { allowShell: true, allowVscode: true, allowFiles: true },
    projectAccess: { fullWorkspace: true },
    temperature: 0.2,
    maxTokens: 8192,
    icon: 'plug'
  },
  {
    id: 'authentication',
    name: 'Authentication Engineer',
    description: 'Implements identity, session management, OAuth/JWT, authorization, and RBAC.',
    purpose: 'Ensure secure user authentication, token rotation, cryptographic hashing, and permission controls.',
    systemPrompt: `You are an Identity & Authentication Security Engineer.
Your purpose is to build rock-solid authentication flows (OAuth, JWT, Session, Passkeys, 2FA) and access control (RBAC/ABAC).
Follow defense-in-depth principles: never store plain-text secrets, always validate token signatures and expiration, and mitigate timing attacks.`,
    primaryModel: 'gemini-2.5-pro',
    fallbackModels: ['claude-sonnet-4-6', 'qwen3.7-plus', 'gemini-2.5-flash'],
    enabled: true,
    toolPermissions: { allowShell: true, allowVscode: true, allowFiles: true },
    projectAccess: { fullWorkspace: true },
    temperature: 0.1,
    maxTokens: 8192,
    icon: 'lock'
  },
  {
    id: 'security',
    name: 'Security Engineer',
    description: 'Audits code for vulnerabilities, injection flaws, data leaks, and insecure dependencies.',
    purpose: 'Perform automated and static security audits, harden endpoints, and verify credential hygiene.',
    systemPrompt: `You are an Application Security Auditor & Pentesting Specialist.
Your purpose is to uncover security risks (SQLi, XSS, CSRF, SSRF, IDOR, path traversal, hardcoded secrets, misconfigurations).
Inspect the complete codebase and dependencies, flag severe risks with remediation code, and ensure strict input sanitization.`,
    primaryModel: 'gemini-2.5-pro',
    fallbackModels: ['claude-sonnet-4-6', 'qwen3.7-plus', 'gemini-2.5-flash'],
    enabled: true,
    toolPermissions: { allowShell: true, allowVscode: true, allowFiles: true },
    projectAccess: { fullWorkspace: true },
    temperature: 0.1,
    maxTokens: 8192,
    icon: 'shield'
  },
  {
    id: 'testing',
    name: 'Testing Engineer',
    description: 'Writes unit, integration, and end-to-end tests; verifies builds and assertion coverage.',
    purpose: 'Ensure software quality through comprehensive automated test suites and build verification.',
    systemPrompt: `You are a Principal Software Quality & Test Automation Engineer.
Your purpose is to write rigorous, maintainable unit tests, integration tests, and edge-case validations.
Execute tests using run_command, verify 100% passing results, and detect regressions or flaky assumptions before sign-off.`,
    primaryModel: 'qwen3.7-plus',
    fallbackModels: ['gemini-2.5-pro', 'claude-sonnet-4-6', 'gemini-2.5-flash'],
    enabled: true,
    toolPermissions: { allowShell: true, allowVscode: true, allowFiles: true },
    projectAccess: { fullWorkspace: true },
    temperature: 0.1,
    maxTokens: 8192,
    icon: 'check-all'
  },
  {
    id: 'devops',
    name: 'DevOps Engineer',
    description: 'Configures CI/CD pipelines, Dockerfiles, environments, deployment scripts, and tooling.',
    purpose: 'Automate build pipelines, containerization, environment configuration, and infrastructure scripts.',
    systemPrompt: `You are a Senior DevOps & Infrastructure Automation Engineer.
Your purpose is to create clean container configurations (Docker/Podman), CI/CD workflows, build scripts, and environment setups.
Ensure idempotent execution, minimal build artifacts, and cross-platform compatibility.`,
    primaryModel: 'gemini-2.5-flash',
    fallbackModels: ['gemini-2.5-pro', 'claude-sonnet-4-6', 'qwen3.7-plus'],
    enabled: true,
    toolPermissions: { allowShell: true, allowVscode: true, allowFiles: true },
    projectAccess: { fullWorkspace: true },
    temperature: 0.2,
    maxTokens: 8192,
    icon: 'gear'
  },
  {
    id: 'uiux',
    name: 'UI/UX Engineer',
    description: 'Focuses on design systems, styling, themes, typography, layout, and user delight.',
    purpose: 'Deliver aesthetically pleasing, consistent, modern visual styling and polished user flows.',
    systemPrompt: `You are a Creative UI/UX Specialist & Design Systems Architect.
Your purpose is to ensure aesthetic visual excellence, consistent typography, elegant color palettes, micro-interactions, and flawless usability.
Eliminate clumsy layouts, awkward margins, and unstyled raw widgets.`,
    primaryModel: 'claude-sonnet-4-6',
    fallbackModels: ['gemini-2.5-pro', 'qwen3.7-plus', 'gemini-2.5-flash'],
    enabled: true,
    toolPermissions: { allowShell: true, allowVscode: true, allowFiles: true },
    projectAccess: { fullWorkspace: true },
    temperature: 0.4,
    maxTokens: 8192,
    icon: 'paintcan'
  },
  {
    id: 'documentation',
    name: 'Documentation Engineer',
    description: 'Authors clear API guides, architecture diagrams, READMEs, changelogs, and inline docs.',
    purpose: 'Keep documentation synchronized, readable, developer-friendly, and completely accurate.',
    systemPrompt: `You are a Lead Technical Writer & Documentation Architect.
Your purpose is to craft precise, elegant markdown documentation, API references, architecture overviews, and changelogs.
Always inspect current active code so documentation accurately matches reality without hallucinated options.`,
    primaryModel: 'claude-sonnet-4-6',
    fallbackModels: ['gemini-2.5-pro', 'qwen3.7-plus', 'gemini-2.5-flash'],
    enabled: true,
    toolPermissions: { allowShell: true, allowVscode: true, allowFiles: true },
    projectAccess: { fullWorkspace: true },
    temperature: 0.2,
    maxTokens: 8192,
    icon: 'book'
  },
  {
    id: 'performance',
    name: 'Performance Engineer',
    description: 'Profiles bottlenecks, reduces latency, optimizes memory consumption, and audits bundle size.',
    purpose: 'Profile and optimize execution speed, queries, memory leaks, and CPU overhead.',
    systemPrompt: `You are a High-Performance Systems & Optimization Specialist.
Your purpose is to diagnose latency bottlenecks, inefficient O(N^2) algorithms, unneeded re-renders, and memory leaks.
Provide targeted optimizations backed by benchmark or profiling evidence.`,
    primaryModel: 'gemini-2.5-pro',
    fallbackModels: ['claude-sonnet-4-6', 'qwen3.7-plus', 'gemini-2.5-flash'],
    enabled: true,
    toolPermissions: { allowShell: true, allowVscode: true, allowFiles: true },
    projectAccess: { fullWorkspace: true },
    temperature: 0.1,
    maxTokens: 8192,
    icon: 'dashboard'
  },
  {
    id: 'code_reviewer',
    name: 'Code Reviewer',
    description: 'Reviews pull requests and code modifications for best practices, correctness, and style.',
    purpose: 'Perform objective, thorough code reviews, verify contracts, and identify regressions.',
    systemPrompt: `You are a Distinguished Staff Engineer & Code Reviewer.
Your purpose is to review newly implemented changes against the user requirements and existing codebase conventions.
Identify logical flaws, unhandled exceptions, race conditions, code smells, or missing verifications.`,
    primaryModel: 'gemini-2.5-pro',
    fallbackModels: ['claude-sonnet-4-6', 'qwen3.7-plus', 'gemini-2.5-flash'],
    enabled: true,
    toolPermissions: { allowShell: true, allowVscode: true, allowFiles: true },
    projectAccess: { fullWorkspace: true },
    temperature: 0.1,
    maxTokens: 8192,
    icon: 'eye'
  }
];

const STORAGE_KEY = 'antigravity.orchestration.roles';

let memoryRoles: RoleDefinition[] | undefined;
let rolesWatcher: vscode.FileSystemWatcher | undefined;
let fsWatchHandle: fs.FSWatcher | undefined;
let reloadDebounce: NodeJS.Timeout | undefined;

export function getWorkspaceRoot(): string | undefined {
  if (vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0) {
    return vscode.workspace.workspaceFolders[0].uri.fsPath;
  }
  return undefined;
}

export function getWorkspaceRolesFilePath(): string | undefined {
  const root = getWorkspaceRoot();
  if (!root) return undefined;
  return path.join(root, '.antigravity', 'roles.json');
}

export function readRolesFromWorkspaceFile(): RoleDefinition[] | null {
  try {
    const filePath = getWorkspaceRolesFilePath();
    if (!filePath || !fs.existsSync(filePath)) return null;
    const raw = fs.readFileSync(filePath, 'utf8');
    const parsed = JSON.parse(raw);
    const rolesList = Array.isArray(parsed) ? parsed : (Array.isArray(parsed.roles) ? parsed.roles : null);
    if (rolesList && rolesList.length > 0) {
      return rolesList.filter((r: any) => r && typeof r.id === 'string' && typeof r.name === 'string');
    }
  } catch (err) {
    console.warn('[roles] Failed to read .antigravity/roles.json:', err);
  }
  return null;
}

export function writeRolesToWorkspaceFile(roles: RoleDefinition[]): string | undefined {
  try {
    const filePath = getWorkspaceRolesFilePath();
    if (!filePath) return undefined;
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    const fileContent = {
      $schema: 'https://antigravity.dev/schemas/roles.v1.json',
      version: '1.0',
      description: '9 Router Specialized AI Roles configuration. Edited automatically by Voice AI or manually.',
      roles
    };
    fs.writeFileSync(filePath, JSON.stringify(fileContent, null, 2), 'utf8');
    return filePath;
  } catch (err) {
    console.warn('[roles] Failed to write .antigravity/roles.json:', err);
    return undefined;
  }
}

export function syncRolesWithWorkspaceFile(context?: vscode.ExtensionContext): RoleDefinition[] {
  const fileRoles = readRolesFromWorkspaceFile();
  if (fileRoles && fileRoles.length > 0) {
    memoryRoles = fileRoles;
    if (context) {
      void context.globalState.update(STORAGE_KEY, fileRoles);
    }
    return fileRoles;
  }
  const current = getRoles(context);
  writeRolesToWorkspaceFile(current);
  return current;
}

export function initRolesFileWatcher(
  context: vscode.ExtensionContext,
  onReload?: (roles: RoleDefinition[]) => void
): vscode.Disposable {
  const filePath = getWorkspaceRolesFilePath();

  const handleReload = () => {
    if (reloadDebounce) clearTimeout(reloadDebounce);
    reloadDebounce = setTimeout(() => {
      const fileRoles = readRolesFromWorkspaceFile();
      if (fileRoles && fileRoles.length > 0) {
        memoryRoles = fileRoles;
        void context.globalState.update(STORAGE_KEY, fileRoles);
        if (onReload) {
          try {
            onReload(fileRoles);
          } catch {}
        }
      }
    }, 200);
  };

  if (filePath) {
    try {
      const dir = path.dirname(filePath);
      const base = path.basename(filePath);
      if (typeof vscode.RelativePattern === 'function') {
        const pattern = new vscode.RelativePattern(dir, base);
        rolesWatcher = vscode.workspace.createFileSystemWatcher(pattern);
        rolesWatcher.onDidChange(handleReload);
        rolesWatcher.onDidCreate(handleReload);
        context.subscriptions.push(rolesWatcher);
      }
    } catch {}

    try {
      const dir = path.dirname(filePath);
      if (fs.existsSync(dir) && !fsWatchHandle) {
        fsWatchHandle = fs.watch(dir, (event, filename) => {
          if (filename === 'roles.json' || !filename) handleReload();
        });
      }
    } catch {}
  }

  return {
    dispose: () => {
      rolesWatcher?.dispose();
      fsWatchHandle?.close();
    }
  };
}

export function getRoles(context?: vscode.ExtensionContext): RoleDefinition[] {
  if (memoryRoles && memoryRoles.length > 0) {
    return memoryRoles;
  }

  const fileRoles = readRolesFromWorkspaceFile();
  if (fileRoles && fileRoles.length > 0) {
    memoryRoles = fileRoles;
    if (context) {
      void context.globalState.update(STORAGE_KEY, fileRoles);
    }
    return fileRoles;
  }

  if (context) {
    const stored = context.globalState.get<RoleDefinition[]>(STORAGE_KEY);
    if (stored && Array.isArray(stored) && stored.length > 0) {
      memoryRoles = stored;
      writeRolesToWorkspaceFile(stored);
      return stored;
    }
  }

  memoryRoles = JSON.parse(JSON.stringify(DEFAULT_ROLES));
  writeRolesToWorkspaceFile(memoryRoles!);
  return memoryRoles ?? DEFAULT_ROLES;
}

export async function saveRoles(context: vscode.ExtensionContext, roles: RoleDefinition[]): Promise<void> {
  memoryRoles = roles;
  await context.globalState.update(STORAGE_KEY, roles);
  writeRolesToWorkspaceFile(roles);
}

export function getRole(id: string, context?: vscode.ExtensionContext): RoleDefinition | undefined {
  const roles = getRoles(context);
  return roles.find((r) => r.id.toLowerCase() === id.toLowerCase());
}

export async function updateRole(context: vscode.ExtensionContext, updated: RoleDefinition): Promise<void> {
  const roles = getRoles(context);
  const idx = roles.findIndex((r) => r.id.toLowerCase() === updated.id.toLowerCase());
  if (idx >= 0) {
    roles[idx] = updated;
  } else {
    roles.push(updated);
  }
  await saveRoles(context, roles);
}

export async function createRole(context: vscode.ExtensionContext, newRole: RoleDefinition): Promise<void> {
  const roles = getRoles(context);
  if (roles.some((r) => r.id.toLowerCase() === newRole.id.toLowerCase())) {
    throw new Error(`Role with ID '${newRole.id}' already exists.`);
  }
  newRole.isCustom = true;
  roles.push(newRole);
  await saveRoles(context, roles);
}

export async function duplicateRole(context: vscode.ExtensionContext, sourceId: string): Promise<RoleDefinition> {
  const roles = getRoles(context);
  const src = roles.find((r) => r.id.toLowerCase() === sourceId.toLowerCase());
  if (!src) throw new Error(`Source role '${sourceId}' not found.`);

  let suffix = 1;
  let newId = `${src.id}_copy`;
  while (roles.some((r) => r.id.toLowerCase() === newId.toLowerCase())) {
    suffix++;
    newId = `${src.id}_copy${suffix}`;
  }

  const copy: RoleDefinition = {
    ...JSON.parse(JSON.stringify(src)),
    id: newId,
    name: `${src.name} (Copy ${suffix > 1 ? suffix : ''})`.trim(),
    isCustom: true
  };

  roles.push(copy);
  await saveRoles(context, roles);
  return copy;
}

export async function deleteRole(context: vscode.ExtensionContext, roleId: string): Promise<boolean> {
  const roles = getRoles(context);
  const filtered = roles.filter((r) => r.id.toLowerCase() !== roleId.toLowerCase());
  if (filtered.length === roles.length) return false;
  await saveRoles(context, filtered);
  return true;
}

export async function toggleRoleEnabled(context: vscode.ExtensionContext, roleId: string): Promise<boolean> {
  const roles = getRoles(context);
  const target = roles.find((r) => r.id.toLowerCase() === roleId.toLowerCase());
  if (!target) return false;
  target.enabled = !target.enabled;
  await saveRoles(context, roles);
  return target.enabled;
}

export async function resetRolesToDefault(context: vscode.ExtensionContext): Promise<void> {
  const defaults = JSON.parse(JSON.stringify(DEFAULT_ROLES));
  await saveRoles(context, defaults);
}

export function exportRolesToJson(roles?: RoleDefinition[]): string {
  const list = roles || memoryRoles || DEFAULT_ROLES;
  return JSON.stringify(
    {
      $schema: 'https://antigravity.dev/schemas/roles.v1.json',
      version: '1.0',
      description: '9 Router Specialized AI Roles configuration. Edited automatically by Voice AI or manually.',
      roles: list
    },
    null,
    2
  );
}

export async function importRolesFromJson(
  context: vscode.ExtensionContext,
  jsonString: string
): Promise<{ success: boolean; count: number; error?: string }> {
  try {
    const parsed = JSON.parse(jsonString);
    const list = Array.isArray(parsed) ? parsed : (Array.isArray(parsed.roles) ? parsed.roles : null);
    if (!list || list.length === 0) {
      return { success: false, count: 0, error: 'JSON does not contain a valid array of roles' };
    }
    const validRoles: RoleDefinition[] = list.filter((r: any) => r && typeof r.id === 'string' && typeof r.name === 'string');
    if (validRoles.length === 0) {
      return { success: false, count: 0, error: 'No valid role objects found in JSON' };
    }
    await saveRoles(context, validRoles);
    return { success: true, count: validRoles.length };
  } catch (err) {
    return { success: false, count: 0, error: err instanceof Error ? err.message : String(err) };
  }
}

