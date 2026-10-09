const fs = require('fs');
const path = require('path');

const rootDir = path.join(__dirname, '..');
const uiDevDir = path.join(rootDir, 'ui-dev');
if (!fs.existsSync(uiDevDir)) {
  fs.mkdirSync(uiDevDir, { recursive: true });
}

// 1. Read catalog to build top models list
const catalogRaw = JSON.parse(fs.readFileSync(path.join(rootDir, 'catalog', 'models.json'), 'utf8'));
const catalogModels = [];

// Ensure ag/gemini-pro-agent is right at the top
const priorityModels = [
  'ag/gemini-pro-agent',
  'ag/gemini-3.8-flash-high',
  'ag/gemini-3.8-flash-medium',
  'ag/gemini-3.8-flash',
  'ag/gemini-3.7-flash-high',
  'ag/gemini-3.1-pro-low',
  'ag/claude-sonnet-4-6',
  'ag/claude-opus-4-6-thinking',
  'ag/gpt-oss-120b-medium',
  'gemini-2.5-pro',
  'gemini-2.5-flash',
  'claude-sonnet-4-6',
  'qwen3.7-plus'
];

for (const id of priorityModels) {
  const caps = catalogRaw.models[id] || { tools: true, reasoning: true, vision: true, contextWindow: 1048576, maxOutput: 64000 };
  catalogModels.push({
    id,
    provider: id.startsWith('ag/') ? 'ag' : (id.split('/')[0] || 'catalog'),
    source: 'catalog',
    live: false,
    caps
  });
}

// Add remaining catalog models up to 150
for (const [id, caps] of Object.entries(catalogRaw.models)) {
  if (catalogModels.some(m => m.id === id)) continue;
  catalogModels.push({
    id,
    provider: id.includes('/') ? id.split('/')[0] : 'catalog',
    source: 'catalog',
    live: false,
    caps: caps || {}
  });
  if (catalogModels.length >= 150) break;
}

// 2. Default Roles from roleRegistry
const defaultRoles = [
  {
    id: 'researcher',
    name: 'Researcher',
    description: 'Investigates codebases, architecture, external libraries, and technical documentation.',
    purpose: 'Analyze requirements, explore dependencies, formulate implementation strategies, and identify pitfalls.',
    systemPrompt: 'You are an elite Research & Architecture AI Engineer.\nYour purpose is to thoroughly investigate codebases, architectural patterns, schemas, dependencies, and external documentation before implementation begins.',
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
    systemPrompt: 'You are a Principal Backend Engineer.\nYour purpose is to write high-performance, robust, and idiomatic server-side code, REST/GraphQL/WebSocket endpoints, and business logic.',
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
    systemPrompt: 'You are a Senior Frontend & UI Engineer.\nYour purpose is to craft responsive, accessible, high-fidelity user interfaces and state management.',
    primaryModel: 'claude-sonnet-4-6',
    fallbackModels: ['gemini-2.5-pro', 'qwen3.7-plus', 'gemini-2.5-flash'],
    enabled: true,
    toolPermissions: { allowShell: true, allowVscode: true, allowFiles: true },
    projectAccess: { fullWorkspace: true },
    temperature: 0.3,
    maxTokens: 8192,
    icon: 'layout'
  },
  {
    id: 'database',
    name: 'Database Architect',
    description: 'Designs schemas, migrations, indices, and data access layers.',
    purpose: 'Ensure relational integrity, optimal indexing, zero data-loss migrations, and fast queries.',
    systemPrompt: 'You are a Senior Database Architect & Data Engineer.',
    primaryModel: 'gemini-2.5-pro',
    fallbackModels: ['claude-sonnet-4-6', 'qwen3.7-plus'],
    enabled: true,
    toolPermissions: { allowShell: true, allowFiles: true },
    projectAccess: { fullWorkspace: true },
    temperature: 0.1,
    maxTokens: 8192,
    icon: 'database'
  },
  {
    id: 'security',
    name: 'Security & Auth Specialist',
    description: 'Audits vulnerabilities, JWT/OAuth auth flows, sanitize inputs, secrets protection.',
    purpose: 'Enforce principle of least privilege, eliminate OWASP vulnerabilities, audit auth flows.',
    systemPrompt: 'You are a Senior Security Engineer & Application Security Specialist.',
    primaryModel: 'claude-sonnet-4-6',
    fallbackModels: ['gemini-2.5-pro'],
    enabled: true,
    toolPermissions: { allowShell: true, allowFiles: true },
    projectAccess: { fullWorkspace: true },
    temperature: 0.1,
    maxTokens: 8192,
    icon: 'shield'
  },
  {
    id: 'testing',
    name: 'QA & Testing Engineer',
    description: 'Writes unit tests, integration tests, E2E suites, and coverage verification.',
    purpose: 'Ensure complete test coverage, edge case validation, and regression prevention.',
    systemPrompt: 'You are a Staff QA & Test Automation Engineer.',
    primaryModel: 'qwen3.7-plus',
    fallbackModels: ['gemini-2.5-flash', 'gemini-2.5-pro'],
    enabled: true,
    toolPermissions: { allowShell: true, allowFiles: true },
    projectAccess: { fullWorkspace: true },
    temperature: 0.2,
    maxTokens: 8192,
    icon: 'check-circle'
  }
];

// 3. Sample Workflow State
const sampleWorkflow = {
  id: 'wf-demo-8888',
  userGoal: 'Build full-stack user authentication and real-time dashboard UI',
  status: 'Running',
  activeStepIndex: 1,
  steps: [
    {
      id: 'step-1',
      roleId: 'database',
      roleName: 'Database Architect',
      assignedModel: 'gemini-2.5-pro',
      status: 'Completed',
      systemPrompt: 'You are a Senior Database Architect & Data Engineer.',
      taskPrompt: 'Define users and session schema tables with proper indexing and migration scripts.',
      progressState: 'Verifying',
      progressPercent: 100,
      progressNote: 'Database schema created & verified.'
    },
    {
      id: 'step-2',
      roleId: 'backend',
      roleName: 'Backend Developer',
      assignedModel: 'ag/gemini-pro-agent',
      status: 'Running',
      systemPrompt: 'You are a Principal Backend Engineer.',
      taskPrompt: 'Implement JWT login endpoint, token verification middleware, and route guards.',
      progressState: 'Editing',
      progressPercent: 65,
      progressNote: 'Writing route guards and password hashing controller...'
    },
    {
      id: 'step-3',
      roleId: 'frontend',
      roleName: 'Frontend Developer',
      assignedModel: 'claude-sonnet-4-6',
      status: 'Queued',
      systemPrompt: 'You are a Senior Frontend & UI Engineer.',
      taskPrompt: 'Build reactive login card and auth context provider.',
      progressState: 'Planning',
      progressPercent: 0,
      progressNote: 'Waiting for backend step completion'
    },
    {
      id: 'step-4',
      roleId: 'testing',
      roleName: 'QA & Testing Engineer',
      assignedModel: 'qwen3.7-plus',
      status: 'Queued',
      systemPrompt: 'You are a Staff QA & Test Automation Engineer.',
      taskPrompt: 'Write comprehensive integration tests for login flow and error cases.',
      progressState: 'Planning',
      progressPercent: 0,
      progressNote: 'Queued'
    }
  ],
  fallbacks: []
};

// 4. Initial State Object
const initialState = {
  workflow: sampleWorkflow,
  roles: defaultRoles,
  selectedModel: 'ag/gemini-pro-agent',
  sessionOpts: {
    temperature: 0.5,
    maxTokens: 4096,
    systemPrompt: 'System instructions for ag/gemini-pro-agent',
    allowShell: true,
    allowVscode: true,
    allowFiles: true,
    maxTurns: 40
  },
  voiceOpts: {
    liveModel: 'gemini-3.1-flash-live-preview',
    ttsVoice: 'Kore',
    inputDevice: '#auto',
    echoCancellation: true
  },
  voiceActive: false,
  voiceTalking: false,
  voiceMuted: false,
  apiKeys: [
    { full: 'AIzaSyMockKey01234567890abcdef', masked: 'AIzaSy...cdef' }
  ],
  filterLive: true,
  liveModels: ['gemini-3.1-flash-live-preview', 'gemini-2.5-flash-native-audio-latest'],
  workspacePath: 'd:\\New folder',
  rolesJsonPath: 'd:\\New folder\\.vscode\\roles.json',
  activeDoc: 'd:\\New folder\\src\\ui\\workflowWebview.ts',
  catalogSize: catalogModels.length,
  topModels: catalogModels.slice(0, 50).map(m => m.id),
  chatMessages: [
    {
      id: 'msg-1',
      sender: 'user',
      content: 'Hello! Please inspect the current workspace and run the UI with ag/gemini-pro-agent on localhost.',
      timestamp: '11:15 AM'
    },
    {
      id: 'msg-2',
      sender: 'ai',
      roleName: 'Main AI',
      roleModel: 'ag/gemini-pro-agent',
      content: 'Hello! I am **ag/gemini-pro-agent** served by 9 Router on `localhost:8888`.\n\nAll control center tabs, serial pipelines, role configuration, model picker, and chat feeds are active and fully customizable. Any changes you make to `style.css`, `index.html`, or `app.js` will hot-reload automatically!',
      timestamp: '11:15 AM'
    }
  ],
  initialTab: 'chat'
};

fs.writeFileSync(path.join(uiDevDir, 'mock-state.json'), JSON.stringify(initialState, null, 2), 'utf8');

// Also save catalogModels for fuzzy search API
fs.writeFileSync(path.join(uiDevDir, 'catalog.json'), JSON.stringify(catalogModels, null, 2), 'utf8');

console.log('Saved mock-state.json and catalog.json successfully.');
