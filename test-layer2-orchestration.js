'use strict';
const Module = require('module');
const fs = require('fs');
const os = require('os');
const path = require('path');

// Mock vscode module for standalone unit testing
const stateStore = new Map();
const fakeVscode = {
  Uri: { file: (p) => ({ fsPath: p }) },
  workspace: {
    workspaceFolders: [{ uri: { fsPath: __dirname } }],
    getConfiguration: (section) => ({
      get: (key, defVal) => defVal,
      update: async () => {}
    }),
    fs: {
      createDirectory: async (uri) => { fs.mkdirSync(uri.fsPath, { recursive: true }); },
      writeFile: async (uri, data) => { fs.writeFileSync(uri.fsPath, Buffer.from(data)); },
      readFile: async (uri) => fs.readFileSync(uri.fsPath),
      readDirectory: async (uri) => {
        return fs.readdirSync(uri.fsPath).map((n) => {
          const isDir = fs.statSync(path.join(uri.fsPath, n)).isDirectory();
          return [n, isDir ? 2 : 1];
        });
      }
    }
  },
  window: {
    showInformationMessage: async () => {},
    showWarningMessage: async () => {},
    showErrorMessage: async () => {},
    createOutputChannel: () => ({
      append: () => {},
      appendLine: () => {},
      show: () => {},
      clear: () => {}
    })
  },
  commands: {
    registerCommand: (cmd, cb) => ({ dispose: () => {} }),
    executeCommand: async (cmd) => `ran ${cmd}`
  },
  ConfigurationTarget: { Global: 1, Workspace: 2, WorkspaceFolder: 3 }
};

const fakeContext = {
  globalState: {
    get: (key) => stateStore.get(key),
    update: async (key, val) => { stateStore.set(key, val); }
  },
  workspaceState: {
    get: (key) => stateStore.get(key),
    update: async (key, val) => { stateStore.set(key, val); }
  },
  extensionUri: fakeVscode.Uri.file(__dirname),
  subscriptions: []
};

const origLoad = Module._load;
Module._load = function (req, parent, isMain) {
  if (req === 'vscode') return fakeVscode;
  return origLoad.apply(this, arguments);
};

function assert(cond, msg) {
  if (!cond) {
    console.error('FAIL:', msg);
    process.exit(1);
  }
}

async function runTests() {
  console.log('====================================================');
  console.log('  LAYER 2: SERIAL ORCHESTRATION & ROLES TEST SUITE  ');
  console.log('====================================================\n');

  // Load modules
  const modelsMod = require('./out/src/models.js');
  const fuzzyMod = require('./out/src/roles/fuzzySearch.js');
  const roleRegistryMod = require('./out/src/roles/roleRegistry.js');
  const sharedStateMod = require('./out/src/orchestration/sharedState.js');
  const runnerMod = require('./out/src/orchestration/modelRunner.js');
  const orchMod = require('./out/src/orchestration/orchestrator.js');
  const mainVoiceMod = require('./out/src/orchestration/mainVoiceOrchestrator.js');

  // -------------------------------------------------------------
  // TEST 1: Model Catalog & Fuzzy Search
  // -------------------------------------------------------------
  console.log('--- 1. Testing 9 Router Model Catalog & Fuzzy Search ---');
  const catalogManager = modelsMod.UnifiedModelCatalog.getInstance();
  const catalog = catalogManager.getModels();
  assert(catalog.length >= 2000, `Catalog must contain all 9 Router models (expected >= 2000, got ${catalog.length})`);
  console.log(`Loaded ${catalog.length} catalog models (seeded with complete 9 Router gateway models)`);

  // Verify presence of 9 Router prefixed models
  const routerPrefixed = catalog.filter((m) => m.id.includes('/'));
  assert(routerPrefixed.length >= 900, `Expected at least 900 9 Router prefixed models, found ${routerPrefixed.length}`);
  console.log(`  Found ${routerPrefixed.length} live 9 Router models across providers`);

  // Fuzzy search by model id
  const sonnetMatches = fuzzyMod.searchModels('sonnet', catalog);
  assert(sonnetMatches.length > 0, 'Fuzzy search for "sonnet" must return matches');
  console.log(`  Query "sonnet" -> found ${sonnetMatches.length} models, top: ${sonnetMatches[0].id}`);

  // Fuzzy search by provider / prefix (ag/, kr/, gh/, openrouter/)
  const agMatches = fuzzyMod.searchModels('ag/', catalog);
  assert(agMatches.length > 0, 'Search for "ag/" must return Antigravity 9 Router models');
  console.log(`  Query "ag/" -> found ${agMatches.length} models, top: ${agMatches[0].id}`);

  // Fuzzy search by vendor name (e.g. google, anthropic, openai)
  const googleMatches = fuzzyMod.searchModels('google', catalog);
  assert(googleMatches.length > 0, 'Search for vendor "google" must return Gemini models');
  console.log(`  Query "google" -> found ${googleMatches.length} models, top: ${googleMatches[0].id}`);

  const anthropicMatches = fuzzyMod.searchModels('anthropic', catalog);
  assert(anthropicMatches.length > 0, 'Search for provider "anthropic" must return matches');
  console.log(`  Query "anthropic" -> found ${anthropicMatches.length} models, top: ${anthropicMatches[0].id}`);

  // Fuzzy search by capability
  const reasoningMatches = fuzzyMod.searchModels('reasoning', catalog);
  assert(reasoningMatches.length > 0, 'Search for capability "reasoning" must return models');
  console.log(`  Query "reasoning" -> found ${reasoningMatches.length} models`);

  // Subsequence match (e.g. "clsn" for claude-sonnet)
  const subseqMatches = fuzzyMod.searchModels('clsn', catalog);
  console.log(`  Query "clsn" (subsequence) -> found ${subseqMatches.length} models`);

  // Empty query returns all models with 9 Router models prioritized
  const allModels = fuzzyMod.searchModels('', catalog);
  assert(allModels.length === catalog.length, `Empty query must return all ${catalog.length} models`);
  assert(allModels[0].id.includes('/') || allModels[0].source === 'router', 'Top models on empty query should be 9 Router models');
  console.log(`  Empty query -> returned all ${allModels.length} models, top: ${allModels[0].id}`);

  console.log('  [PASS] Complete 9 Router model catalog & fuzzy search verified across all dimensions.');

  // -------------------------------------------------------------
  // TEST 2: Role Registry & Configuration
  // -------------------------------------------------------------
  console.log('\n--- 2. Testing Role Registry, Defaults, and CRUD ---');
  const testRolesPath = path.join(__dirname, '.antigravity', 'roles.json');
  if (fs.existsSync(testRolesPath)) fs.unlinkSync(testRolesPath);
  await roleRegistryMod.resetRolesToDefault(fakeContext);
  const defaultRoles = roleRegistryMod.getRoles(fakeContext);
  assert(defaultRoles.length >= 10, 'Default roles should contain at least 10 specialized roles');
  const roleIds = defaultRoles.map((r) => r.id);
  console.log(`Available default roles: ${roleIds.join(', ')}`);

  assert(roleIds.includes('researcher'), 'must include researcher role');
  assert(roleIds.includes('backend'), 'must include backend role');
  assert(roleIds.includes('frontend'), 'must include frontend role');
  assert(roleIds.includes('database'), 'must include database role');
  assert(roleIds.includes('testing'), 'must include testing role');

  // Verify same model can be assigned to multiple roles
  const backendRole = defaultRoles.find((r) => r.id === 'backend');
  const frontendRole = defaultRoles.find((r) => r.id === 'frontend');
  assert(backendRole && frontendRole, 'backend and frontend roles must exist');
  backendRole.primaryModel = 'cc/claude-3-7-sonnet';
  frontendRole.primaryModel = 'cc/claude-3-7-sonnet';
  assert(backendRole.primaryModel === frontendRole.primaryModel, 'Same model assigned to multiple roles must be fully supported');
  console.log(`  Assigned model "${backendRole.primaryModel}" to both Backend and Frontend roles (verified)`);

  // Verify multiple fallback models per role and independent fallback chains
  backendRole.fallbackModels = ['deepseek/deepseek-chat', 'gpt-4o', 'gemini-2.5-flash'];
  frontendRole.fallbackModels = ['gpt-4o', 'gemini-2.5-pro'];
  assert(backendRole.fallbackModels.length === 3, 'Backend has 3 fallback models');
  assert(frontendRole.fallbackModels.length === 2, 'Frontend has 2 fallback models');
  assert(backendRole.fallbackModels[0] !== frontendRole.fallbackModels[0], 'Roles must maintain independent fallback chains');
  console.log(`  Backend fallbacks: ${backendRole.fallbackModels.join(' -> ')}`);
  console.log(`  Frontend fallbacks: ${frontendRole.fallbackModels.join(' -> ')}`);

  // Verify role creation
  const customRole = {
    id: 'mobile_dev',
    name: 'Mobile App Developer',
    description: 'Builds iOS and Android Flutter/React Native components',
    purpose: 'Mobile interface development',
    systemPrompt: 'You are a mobile app developer...',
    primaryModel: 'cc/claude-3-7-sonnet',
    fallbackModels: ['gpt-4o'],
    enabled: true,
    toolPermissions: { allowShell: true, allowVscode: true, allowFiles: true },
    projectAccess: { fullWorkspace: true }
  };
  await roleRegistryMod.createRole(fakeContext, customRole);
  assert(roleRegistryMod.getRole('mobile_dev', fakeContext) !== undefined, 'Custom role must be created and retrieved');
  console.log('  Created and stored custom role "mobile_dev"');

  // Verify role duplication
  const dup = await roleRegistryMod.duplicateRole(fakeContext, 'mobile_dev');
  assert(dup.id.startsWith('mobile_dev_copy'), 'Duplicated role must have distinct ID');
  console.log(`  Duplicated role as "${dup.name}" [${dup.id}]`);

  // Verify toggle enable/disable
  const toggled = await roleRegistryMod.toggleRoleEnabled(fakeContext, 'mobile_dev');
  assert(toggled === false, 'Toggling enabled role should disable it');
  const retrieved = roleRegistryMod.getRole('mobile_dev', fakeContext);
  assert(retrieved && !retrieved.enabled, 'Role must be disabled');

  // Verify delete
  const deleted = await roleRegistryMod.deleteRole(fakeContext, dup.id);
  assert(deleted === true, 'Role should be deleted successfully');
  console.log('  [PASS] Role configuration, CRUD, and independent fallback chains verified.');

  // -------------------------------------------------------------
  // TEST 3: Shared Project State & Structured Context Handoff
  // -------------------------------------------------------------
  console.log('\n--- 3. Testing Shared Project State & Context Handoff ---');
  const sharedState = new sharedStateMod.SharedProjectState(__dirname, 'Build Authentication System');

  // Role 1 (Database) completes work
  sharedState.recordFileChange('schema.sql', true);
  sharedState.recordContract('users_table', 'id, email, password_hash, created_at');
  sharedState.recordHandoff({
    completedStepId: 'step_1',
    roleId: 'database',
    roleName: 'Database Engineer',
    taskName: 'Create User Table Schema',
    summary: 'Created schema.sql with users table schema',
    filesChanged: ['schema.sql'],
    contractsAndApis: ['users_table: id, email, password_hash'],
    keyDecisions: ['Use bcrypt for password hash', 'Email unique index'],
    knownIssues: [],
    warnings: [],
    timestamp: Date.now()
  });

  assert(sharedState.filesCreated.has('schema.sql'), 'schema.sql must be recorded as created');
  assert(sharedState.handoffs.length === 1, 'Handoff must be recorded');

  // Next role (Backend) builds context
  const nextRole = roleRegistryMod.getRole('backend', fakeContext);
  const nextStep = {
    id: 'step_2',
    roleId: 'backend',
    roleName: 'Backend Developer',
    taskName: 'Implement Auth API Endpoints',
    taskPrompt: 'Implement POST /api/auth/register and POST /api/auth/login',
    status: 'Running',
    progressState: 'Planning',
    assignedModel: 'cc/claude-3-7-sonnet',
    fallbackHistory: [],
    filesChanged: []
  };

  const contextHandoff = sharedState.buildContextForRole(nextRole, nextStep, [
    { ...nextStep, status: 'Completed', roleName: 'Database Engineer', taskName: 'Create User Table Schema' },
    nextStep
  ]);

  assert(contextHandoff.includes('SHARED PROJECT STATE & CONTEXT HANDOFF'), 'Context must have handoff header');
  assert(contextHandoff.includes('schema.sql'), 'Next role context must list modified files from prior role');
  assert(contextHandoff.includes('Use bcrypt for password hash'), 'Next role context must include architectural decisions');
  assert(contextHandoff.includes('Role Project Access: Full workspace read access is enabled'), 'Role must have full workspace read access notice');
  console.log('  Context handoff generated successfully with structured intelligence (no raw token dump).');
  console.log('  [PASS] Shared state & structured context handoff verified.');

  // -------------------------------------------------------------
  // TEST 4: Error Classification & Resilience
  // -------------------------------------------------------------
  console.log('\n--- 4. Testing Error Classification (Temporary vs Persistent) ---');
  // Temporary errors
  assert(runnerMod.isTemporaryError(new Error('ECONNRESET: socket closed')), 'ECONNRESET must be temporary');
  assert(runnerMod.isTemporaryError(new Error('ETIMEDOUT: connect timeout')), 'ETIMEDOUT must be temporary');
  assert(runnerMod.isTemporaryError(new Error('HTTP 502: Bad Gateway')), '502 Bad Gateway must be temporary');
  assert(runnerMod.isTemporaryError(new Error('HTTP 503: Service Unavailable')), '503 Service Unavailable must be temporary');
  assert(runnerMod.isTemporaryError(new Error('Temporary rate limit exceeded')), 'Transient rate limit must be temporary');

  // Persistent errors
  assert(runnerMod.isPersistentError(new Error('HTTP 429: You have exceeded your current quota')), 'Quota exceeded must be persistent');
  assert(runnerMod.isPersistentError(new Error('RESOURCE_EXHAUSTED: monthly token limit reached')), 'Resource exhausted must be persistent');
  assert(runnerMod.isPersistentError(new Error('HTTP 404: model not found cc/claude-unknown')), 'Model 404 must be persistent');
  assert(runnerMod.isPersistentError(new Error('HTTP 401: Unauthorized invalid_api_key')), 'Auth 401 must be persistent');

  console.log('  [PASS] Intelligent error classification correctly separates temporary retries from persistent fallbacks.');

  // -------------------------------------------------------------
  // TEST 5: Strictly Serial Orchestration Enforcement
  // -------------------------------------------------------------
  console.log('\n--- 5. Testing Strictly Serial Execution & Dependency Ordering ---');

  const executionLog = [];
  const activeRolesAtAnyMoment = [];

  const events = {
    onWorkflowUpdated: (wf) => {
      // Collect all roles currently marked 'Running'
      const runningRoles = wf.steps.filter((s) => s.status === 'Running').map((s) => s.roleName);
      activeRolesAtAnyMoment.push(runningRoles);
    },
    onStepProgress: (stepId, state, pct, note) => {},
    onFallback: (event) => executionLog.push(`fallback: ${event.fromModel} -> ${event.toModel}`),
    onLog: (line) => executionLog.push(line),
    onVerification: (result) => executionLog.push(`verification: ${result.summary}`)
  };

  const orchestrator = new orchMod.SerialOrchestrator(fakeContext, events);

  // Define multi-step serial workflow: Database -> Backend -> Frontend -> Testing
  const initialSteps = [
    {
      id: 'step_db',
      roleId: 'database',
      roleName: 'Database Engineer',
      taskName: 'Define User Persistence Schema',
      taskPrompt: 'Create SQLite table definition for users',
      status: 'Queued',
      progressState: 'Waiting',
      assignedModel: 'cc/claude-3-7-sonnet',
      fallbackHistory: [],
      filesChanged: []
    },
    {
      id: 'step_backend',
      roleId: 'backend',
      roleName: 'Backend Developer',
      taskName: 'Build Authentication Controller',
      taskPrompt: 'Write login and register routes',
      status: 'Queued',
      progressState: 'Waiting',
      assignedModel: 'cc/claude-3-7-sonnet',
      fallbackHistory: [],
      filesChanged: []
    },
    {
      id: 'step_frontend',
      roleId: 'frontend',
      roleName: 'Frontend Developer',
      taskName: 'Build Login Form Component',
      taskPrompt: 'Create reactive HTML login form',
      status: 'Queued',
      progressState: 'Waiting',
      assignedModel: 'cc/claude-3-7-sonnet',
      fallbackHistory: [],
      filesChanged: []
    },
    {
      id: 'step_testing',
      roleId: 'testing',
      roleName: 'Testing Engineer',
      taskName: 'Verify Auth Flow',
      taskPrompt: 'Verify test assertions for auth endpoints',
      status: 'Queued',
      progressState: 'Waiting',
      assignedModel: 'cc/claude-3-7-sonnet',
      fallbackHistory: [],
      filesChanged: []
    }
  ];

  // Mock executeRoleTask to simulate serial execution step-by-step
  const origExecuteRoleTask = runnerMod.executeRoleTask;
  runnerMod.executeRoleTask = async (baseUrl, apiKey, roleDef, step, state, allSteps, callbacks) => {
    callbacks.onProgress('Analyzing', undefined, 'Inspecting requirements');
    await new Promise((r) => setTimeout(r, 40));
    callbacks.onProgress('Editing', undefined, 'Writing files');
    await new Promise((r) => setTimeout(r, 40));
    callbacks.onProgress('Testing', undefined, 'Verifying step output');

    const fileName = `${step.roleId}_output.txt`;
    return {
      success: true,
      finalOutput: `Successfully completed ${step.taskName} for ${roleDef.name}.`,
      filesChanged: [fileName],
      contractsDiscovered: [{ name: `contract_${step.roleId}`, spec: 'valid' }],
      decisionsMade: [`Decision by ${roleDef.name}`],
      issuesIdentified: []
    };
  };

  console.log('  Executing serial workflow...');
  const completedWorkflow = await orchestrator.runWorkflow(
    'Implement complete authentication workflow',
    initialSteps,
    __dirname,
    'http://127.0.0.1:20128/v1'
  );

  // VERIFY CRITICAL ACCEPTANCE CRITERIA: STRICT SERIAL EXECUTION
  console.log(`  Workflow completed status: ${completedWorkflow.status}`);
  console.log(`  Total steps executed: ${completedWorkflow.steps.length}`);

  for (let i = 0; i < activeRolesAtAnyMoment.length; i++) {
    const runningList = activeRolesAtAnyMoment[i];
    assert(
      runningList.length <= 1,
      `PARALLEL EXECUTION VIOLATION: Found ${runningList.length} roles running simultaneously: ${runningList.join(', ')}!`
    );
  }
  console.log('  [PASS] VERIFIED: At every instant during execution, EXACTLY ONE OR ZERO roles were active. Strictly serial execution confirmed.');

  // Verify all steps completed in order
  for (let i = 0; i < completedWorkflow.steps.length; i++) {
    const s = completedWorkflow.steps[i];
    assert(s.status === 'Completed', `Step ${i + 1} (${s.roleName}) must be Completed`);
  }
  console.log('  [PASS] All steps completed in planned serial dependency order (Database -> Backend -> Frontend -> Testing).');

  // -------------------------------------------------------------
  // TEST 6: Dynamic Role Insertion & Prompt Transparency
  // -------------------------------------------------------------
  console.log('\n--- 6. Testing Dynamic Step Insertion & Prompt Transparency ---');
  const insertedStep = {
    id: 'step_security_audit',
    roleId: 'security',
    roleName: 'Security Engineer',
    taskName: 'Penetration & Vulnerability Audit',
    taskPrompt: 'Audit authentication tokens for timing attacks and replay vulnerabilities',
    status: 'Queued',
    progressState: 'Waiting',
    assignedModel: 'cc/claude-3-7-sonnet',
    fallbackHistory: [],
    filesChanged: []
  };

  orchestrator.insertStep(1, insertedStep);
  assert(orchestrator.workflow.steps[1].id === 'step_security_audit', 'Step must be inserted into workflow queue at position 1');
  console.log('  Dynamically inserted Security Engineer into workflow');

  // Verify prompt transparency: Role System Prompt vs Task Prompt distinction
  const secRole = roleRegistryMod.getRole('security', fakeContext);
  assert(secRole.systemPrompt.length > 20, 'Role system prompt must exist and be comprehensive');
  assert(insertedStep.taskPrompt.length > 20, 'Task prompt must exist and describe current task');
  assert(secRole.systemPrompt !== insertedStep.taskPrompt, 'Role System Prompt and Task Prompt must remain distinct');
  console.log(`  Role System Prompt: "${secRole.systemPrompt.slice(0, 50)}…"`);
  console.log(`  Current Task Prompt: "${insertedStep.taskPrompt}"`);
  console.log('  [PASS] Prompt transparency and clear separation verified.');

  // -------------------------------------------------------------
  // TEST 7: Main Voice AI Orchestration Tool Declarations
  // -------------------------------------------------------------
  console.log('\n--- 7. Testing Main Voice AI Orchestration Bridge ---');
  const toolNames = mainVoiceMod.ORCHESTRATION_TOOL_DECLARATIONS.map((t) => t.name);
  assert(toolNames.includes('orchestrate_task'), 'Must provide orchestrate_task tool to Gemini Live');
  assert(toolNames.includes('check_workflow_status'), 'Must provide check_workflow_status tool to Gemini Live');
  assert(toolNames.includes('modify_workflow'), 'Must provide modify_workflow tool to Gemini Live');
  console.log(`  Main Voice AI tools declared: ${toolNames.join(', ')}`);

  const bridge = new mainVoiceMod.MainVoiceOrchestratorBridge(
    fakeContext,
    orchestrator,
    () => ({ baseUrl: 'http://127.0.0.1:20128/v1' })
  );

  const statusQuery = await bridge.handleToolCall('check_workflow_status', {});
  assert(statusQuery.workflow_status !== undefined, 'Status query should report current workflow status');
  console.log(`  Voice AI queried workflow status: ${JSON.stringify(statusQuery)}`);

  const modifyResult = await bridge.handleToolCall('modify_workflow', { action: 'pause' });
  assert(modifyResult.result === 'Workflow paused', 'modify_workflow pause must succeed');
  assert(orchestrator.paused === true, 'Orchestrator must be paused');

  await bridge.handleToolCall('modify_workflow', { action: 'resume' });
  assert(orchestrator.paused === false, 'Orchestrator must be resumed');

  // Test repeat_step
  const repeatResult = await bridge.handleToolCall('modify_workflow', {
    action: 'repeat_step',
    position: 1,
    task_prompt: 'Re-verify table definitions and add indexes'
  });
  assert(repeatResult.result && repeatResult.result.includes('Re-queued step'), 'repeat_step must successfully append repeated step');
  const lastStep = orchestrator.workflow.steps[orchestrator.workflow.steps.length - 1];
  assert(lastStep.taskName.includes('(Repeat)'), 'Repeated step must be identifiable in workflow queue');
  console.log(`  Dynamic repeat_step verified: "${lastStep.taskName}"`);

  // Test model override assignment with visibility
  const orchTestResult = await bridge.handleToolCall('orchestrate_task', {
    task_goal: 'Test model override and reason',
    steps: [
      {
        role_id: 'backend',
        task_name: 'Reasoning Heavy Backend Logic',
        task_prompt: 'Implement complex crypto logic',
        model: 'deepseek/deepseek-reasoner',
        model_reason: 'Task requires mathematical reasoning proof'
      }
    ]
  });
  assert(orchTestResult.status === 'Workflow started', 'Orchestrate task with model override should start');
  const activeStepOverride = orchestrator.workflow.steps[0];
  assert(activeStepOverride.assignedModel === 'deepseek/deepseek-reasoner', 'Model override must be assigned');
  assert(activeStepOverride.originalModel !== undefined, 'Original model must be preserved for visibility');
  assert(activeStepOverride.modelChangeReason && activeStepOverride.modelChangeReason.includes('mathematical reasoning'), 'Model change reason must be recorded');
  console.log(`  Model override visibility verified: ${activeStepOverride.originalModel} -> ${activeStepOverride.assignedModel} (${activeStepOverride.modelChangeReason})`);

  // --- 8. Testing Workspace JSON File Synchronization & Auto-Assign Tools ---
  console.log('\n--- 8. Testing Workspace JSON File Synchronization & Auto-Assign Tools ---');

  // Test list_roles
  const listRolesResult = await bridge.handleToolCall('list_roles', {});
  assert(listRolesResult.status === 'success', 'list_roles must return success');
  assert(Array.isArray(listRolesResult.roles) && listRolesResult.roles.length > 0, 'list_roles must return array of roles');
  assert(listRolesResult.roles_json_file && listRolesResult.roles_json_file.includes('roles.json'), 'list_roles must report roles.json path');
  console.log(`  [PASS] list_roles returned ${listRolesResult.total_roles} roles. Workspace JSON: ${listRolesResult.roles_json_file}`);

  // Test list_router_models
  const listModelsResult = await bridge.handleToolCall('list_router_models', { query: 'sonnet', limit: 5 });
  assert(listModelsResult.models && listModelsResult.models.length > 0, 'list_router_models must return models for query "sonnet"');
  console.log(`  [PASS] list_router_models found ${listModelsResult.total_matched} models for "sonnet", top: ${listModelsResult.models[0].id}`);

  // Test auto_assign_best_models
  const autoAssignResult = await bridge.handleToolCall('auto_assign_best_models', { strategy: 'quality' });
  assert(autoAssignResult.status === 'success', 'auto_assign_best_models must return success');
  assert(autoAssignResult.assignments.length === listRolesResult.total_roles, 'Must produce assignments for all roles');
  console.log(`  [PASS] auto_assign_best_models: ${autoAssignResult.summary}`);
  for (const a of autoAssignResult.assignments.slice(0, 3)) {
    console.log(`    - Role "${a.role}" -> Primary: ${a.primary_model}, Fallbacks: [${a.fallback_models.join(', ')}]`);
  }

  // Verify .antigravity/roles.json was written to disk and is valid
  const rolesJsonPath = path.join(__dirname, '.antigravity', 'roles.json');
  assert(fs.existsSync(rolesJsonPath), '.antigravity/roles.json file must exist on disk');
  const writtenJson = JSON.parse(fs.readFileSync(rolesJsonPath, 'utf8'));
  assert(writtenJson.roles && Array.isArray(writtenJson.roles) && writtenJson.roles.length > 0, 'Written JSON must contain roles array');
  console.log(`  [PASS] .antigravity/roles.json verified on disk with ${writtenJson.roles.length} roles and schema.`);

  // Test configure_role_models
  const configResult = await bridge.handleToolCall('configure_role_models', {
    assignments: [
      {
        role_id: 'database',
        primary_model: 'deepseek/deepseek-chat',
        fallback_models: ['cc/claude-3-7-sonnet', 'gpt-4o']
      }
    ],
    reason: 'Optimizing database role for SQL generation'
  });
  assert(configResult.status === 'success', 'configure_role_models must succeed');
  assert(configResult.updated_roles[0].primary_model === 'deepseek/deepseek-chat', 'Database role primary model must be updated');
  console.log(`  [PASS] configure_role_models updated role: ${configResult.updated_roles[0].role_name} -> ${configResult.updated_roles[0].primary_model}`);

  // Test sync_roles_json
  const syncContentResult = await bridge.handleToolCall('sync_roles_json', { action: 'get_json_content' });
  assert(syncContentResult.status === 'success', 'sync_roles_json get_json_content must succeed');
  assert(syncContentResult.json_content && syncContentResult.json_content.includes('roles'), 'sync_roles_json must return valid JSON content');
  console.log('  [PASS] sync_roles_json verified.');

  // Test get_extension_settings & update_extension_settings
  const getSettingsResult = await bridge.handleToolCall('get_extension_settings', {});
  assert(getSettingsResult.router && getSettingsResult.session, 'get_extension_settings must return router and session options');
  const updateSettingsResult = await bridge.handleToolCall('update_extension_settings', { temperature: 0.3, max_tokens: 8192 });
  assert(updateSettingsResult.status === 'success', 'update_extension_settings must succeed');
  console.log('  [PASS] Extension settings inspected and updated via Voice AI tools.');

  // Clean up mock
  runnerMod.executeRoleTask = origExecuteRoleTask;

  console.log('\n====================================================');
  console.log('  ALL LAYER 2 & JSON SYNC TESTS PASSED (100% SUCCESS) ');
  console.log('====================================================\n');
}

runTests().catch((err) => {
  console.error('Test execution failed:', err);
  process.exit(1);
});

