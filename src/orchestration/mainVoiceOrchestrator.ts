import * as vscode from 'vscode';
import { SerialOrchestrator } from './orchestrator';
import { TaskStep, RoleDefinition } from '../roles/types';
import {
  getRoles,
  getRole,
  saveRoles,
  getWorkspaceRolesFilePath,
  readRolesFromWorkspaceFile,
  writeRolesToWorkspaceFile,
  exportRolesToJson
} from '../roles/roleRegistry';
import { autoAssignBestModelsForRoles, AssignmentStrategy } from '../roles/roleModelAdvisor';
import { UnifiedModelCatalog, ModelInfo, check9RouterStatus } from '../models';
import { searchModels } from '../roles/fuzzySearch';
import { WorkflowWebviewPanel } from '../ui/workflowWebview';

export const ORCHESTRATION_TOOL_DECLARATIONS = [
  {
    name: 'orchestrate_task',
    description: 'Decompose a user request into a dependency-aware, strictly serial workflow executed by specialized engineering roles.',
    parameters: {
      type: 'object',
      properties: {
        task_goal: {
          type: 'string',
          description: 'The overall user request or objective to accomplish.'
        },
        dependency_reasoning: {
          type: 'string',
          description: 'Architectural reasoning for the chosen role sequence and dependencies.'
        },
        steps: {
          type: 'array',
          description: 'Ordered list of specialized roles to execute in strict serial sequence.',
          items: {
            type: 'object',
            properties: {
              role_id: {
                type: 'string',
                description: 'The ID of the specialized role (e.g. researcher, backend, frontend, database, api, testing, devops, security, etc.).'
              },
              task_name: {
                type: 'string',
                description: 'Brief title for this serial task (e.g. "Design Auth Database Schema").'
              },
              task_prompt: {
                type: 'string',
                description: 'Specific, detailed instructions for this role to execute for this step.'
              },
              model: {
                type: 'string',
                description: 'Optional model override from 9 Router (e.g. cc/claude-3-7-sonnet, deepseek/deepseek-chat, gpt-4o).'
              },
              model_reason: {
                type: 'string',
                description: 'Reason for assigning or changing the model for this step.'
              },
              special_instructions: {
                type: 'string',
                description: 'Optional temporary overrides or specific constraints.'
              }
            },
            required: ['role_id', 'task_name', 'task_prompt']
          }
        }
      },
      required: ['task_goal', 'steps']
    }
  },
  {
    name: 'cancel_workflow',
    description: 'Cancel, halt, and immediately stop the running serial orchestration workflow and all active role tasks.',
    parameters: {
      type: 'object',
      properties: {
        reason: {
          type: 'string',
          description: 'Reason for cancelling the workflow (e.g. user requested cancellation, stop, halt).'
        }
      }
    }
  },
  {
    name: 'pause_workflow',
    description: 'Pause the currently executing serial orchestration workflow.',
    parameters: {
      type: 'object',
      properties: {
        reason: {
          type: 'string',
          description: 'Reason for pausing the workflow.'
        }
      }
    }
  },
  {
    name: 'resume_workflow',
    description: 'Resume the paused serial orchestration workflow.',
    parameters: {
      type: 'object',
      properties: {}
    }
  },
  {
    name: 'check_router_status',
    description: 'Check whether 9 Router gateway is running and reachable in the background.',
    parameters: {
      type: 'object',
      properties: {}
    }
  },
  {
    name: 'check_workflow_status',
    description: 'Inspect the current running serial workflow, active role, progress, and completed steps.',
    parameters: {
      type: 'object',
      properties: {}
    }
  },
  {
    name: 'modify_workflow',
    description: 'Dynamically adapt the running workflow (insert a new role, repeat a completed role, append a follow-up role, pause, resume, or cancel).',
    parameters: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['insert_step', 'append_step', 'repeat_step', 'pause', 'resume', 'cancel'],
          description: 'Action to perform on the workflow.'
        },
        role_id: {
          type: 'string',
          description: 'Role ID if inserting or appending a step.'
        },
        step_id: {
          type: 'string',
          description: 'Step ID to repeat if action is repeat_step.'
        },
        task_name: {
          type: 'string',
          description: 'Task title if inserting or appending.'
        },
        task_prompt: {
          type: 'string',
          description: 'Task instructions for the role.'
        },
        special_instructions: {
          type: 'string',
          description: 'Temporary instructions or feedback for the repeated or inserted step.'
        },
        position: {
          type: 'integer',
          description: 'Index at which to insert (1-indexed).'
        }
      },
      required: ['action']
    }
  },
  {
    name: 'list_roles',
    description: 'List all configured specialized AI roles, their enabled status, primary assigned model, fallback models, and purpose. Use this to inspect roles anytime, including before running any task.',
    parameters: {
      type: 'object',
      properties: {}
    }
  },
  {
    name: 'list_router_models',
    description: 'Query and search AI models available from the 9 Router gateway and catalog. Filter by keyword, provider, or capabilities (coding, reasoning, tools, vision).',
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Search keyword (e.g. claude, sonnet, deepseek, gpt-4o, gemini, coder, qwen).'
        },
        provider: {
          type: 'string',
          description: 'Optional provider filter (e.g. anthropic, openai, deepseek, google, meta).'
        },
        capability: {
          type: 'string',
          enum: ['all', 'coding', 'reasoning', 'tools', 'vision'],
          description: 'Filter by required capability.'
        },
        limit: {
          type: 'integer',
          description: 'Maximum number of models to return (default: 25).'
        }
      }
    }
  },
  {
    name: 'configure_role_models',
    description: 'Assign or update the primary model and fallback model chain for one or more specialized roles. Saves immediately to workspace .antigravity/roles.json and updates the IDE.',
    parameters: {
      type: 'object',
      properties: {
        assignments: {
          type: 'array',
          description: 'List of role model assignments to apply.',
          items: {
            type: 'object',
            properties: {
              role_id: {
                type: 'string',
                description: 'The ID of the role to update (e.g. backend, researcher, frontend, database, security, testing).'
              },
              primary_model: {
                type: 'string',
                description: 'Primary model ID from 9 Router (e.g. cc/claude-3-7-sonnet, deepseek/deepseek-chat, gpt-4o).'
              },
              fallback_models: {
                type: 'array',
                description: 'Ordered fallback models to use if the primary model encounters rate limits or errors.',
                items: { type: 'string' }
              },
              enabled: {
                type: 'boolean',
                description: 'Whether this role is enabled for orchestration workflows.'
              }
            },
            required: ['role_id']
          }
        },
        reason: {
          type: 'string',
          description: 'Reason for changing or assigning these models.'
        }
      },
      required: ['assignments']
    }
  },
  {
    name: 'auto_assign_best_models',
    description: 'Automatically evaluate and assign the optimal 9 Router models and multi-provider fallback chains for ALL specialized engineering roles according to each role\'s specific requirements (coding, reasoning, UI styling, database, security, etc.). Saves immediately to .antigravity/roles.json.',
    parameters: {
      type: 'object',
      properties: {
        strategy: {
          type: 'string',
          enum: ['quality', 'balanced', 'cost_efficient'],
          description: 'Optimization strategy (default: "quality" for premier SOTA models like Claude 3.7 Sonnet, DeepSeek-Reasoner, GPT-4o).'
        },
        reason: {
          type: 'string',
          description: 'Optional instruction or context for why auto-assignment is being performed.'
        }
      }
    }
  },
  {
    name: 'sync_roles_json',
    description: 'Manage synchronization between memory/IDE state and the workspace JSON configuration file (.antigravity/roles.json).',
    parameters: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['reload_from_file', 'save_to_file', 'get_json_content'],
          description: 'Action to perform: reload_from_file re-reads .antigravity/roles.json; save_to_file writes current roles to disk; get_json_content returns the raw JSON and file path.'
        }
      },
      required: ['action']
    }
  },
  {
    name: 'get_extension_settings',
    description: 'Inspect the current 9 Router extension configuration settings (router base URL, voice live model, session temperature, max tokens, permissions).',
    parameters: {
      type: 'object',
      properties: {}
    }
  },
  {
    name: 'update_extension_settings',
    description: 'Update one or more 9 Router extension configuration settings.',
    parameters: {
      type: 'object',
      properties: {
        router_base_url: {
          type: 'string',
          description: '9 Router base URL (e.g. http://127.0.0.1:20128/v1).'
        },
        live_model: {
          type: 'string',
          description: 'Voice live model ID (e.g. gemini-3.8-live, gemini-3.1-flash-live-preview).'
        },
        temperature: {
          type: 'number',
          description: 'Sampling temperature for chat/orchestration (0.0 to 1.0).'
        },
        max_tokens: {
          type: 'number',
          description: 'Maximum tokens produced per reply.'
        },
        allow_shell: {
          type: 'boolean',
          description: 'Allow shell command execution.'
        },
        allow_files: {
          type: 'boolean',
          description: 'Allow file operations.'
        }
      }
    }
  }
];

export class MainVoiceOrchestratorBridge {
  private orchestrator: SerialOrchestrator;
  private context: vscode.ExtensionContext;
  private getSettings: () => { baseUrl: string; apiKey?: string };

  constructor(
    context: vscode.ExtensionContext,
    orchestrator: SerialOrchestrator,
    getSettings: () => { baseUrl: string; apiKey?: string }
  ) {
    this.context = context;
    this.orchestrator = orchestrator;
    this.getSettings = getSettings;
  }

  public async handleToolCall(name: string, args: Record<string, any>): Promise<Record<string, any>> {
    if (name === 'orchestrate_task') {
      const goal = String(args.task_goal || '');
      const rawSteps = Array.isArray(args.steps) ? args.steps : [];
      const workspaceRoots = vscode.workspace.workspaceFolders;
      const rootPath = workspaceRoots && workspaceRoots.length > 0 ? workspaceRoots[0].uri.fsPath : process.cwd();

      const taskSteps: TaskStep[] = [];
      for (let i = 0; i < rawSteps.length; i++) {
        const s = rawSteps[i];
        const roleId = String(s.role_id || '').toLowerCase().trim();
        const roleDef = getRole(roleId, this.context) || getRole('backend', this.context);
        const roleName = roleDef ? roleDef.name : roleId;
        const model = roleDef ? roleDef.primaryModel : 'cc/claude-3-7-sonnet';

        const assignedModel = s.model && s.model.trim() ? s.model.trim() : (roleDef ? roleDef.primaryModel : 'cc/claude-3-7-sonnet');
        const originalModel = roleDef ? roleDef.primaryModel : assignedModel;
        const modelChanged = assignedModel !== originalModel;
        const changeReason = modelChanged
          ? (s.model_reason || 'Model re-assigned by Main Voice AI to better match task requirements')
          : undefined;

        taskSteps.push({
          id: `step_${i + 1}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
          roleId: roleDef ? roleDef.id : roleId,
          roleName,
          taskName: String(s.task_name || `Step ${i + 1}`),
          taskPrompt: String(s.task_prompt || ''),
          temporaryInstructions: s.special_instructions ? String(s.special_instructions) : undefined,
          status: 'Queued',
          progressState: 'Waiting',
          assignedModel,
          originalModel: modelChanged ? originalModel : undefined,
          modelChangeReason: changeReason,
          fallbackHistory: [],
          filesChanged: []
        });
      }

      const { baseUrl, apiKey } = this.getSettings();

      // Check if 9Router is enabled & running in the background
      const routerCheck = await check9RouterStatus(baseUrl, apiKey, 3000);
      if (!routerCheck.online) {
        const msg = `9Router is not enabled or running in the background (${baseUrl}). The autonomous task cannot be started.`;
        vscode.window.showErrorMessage(msg);
        return {
          error: '9router_not_running',
          message: msg,
          spoken_advice: '9Router background mein enable ya running nahi hai. Kripya pehle 9Router ko background mein enable/start karein, uske baad hi autonomous workflow chalu ho payega.',
          instruction: 'Inform the user immediately in natural Hindi/English that 9Router is not running in the background and must be enabled before the task can start.'
        };
      }

      // Launch workflow in background so voice AI remains responsive and supervises
      void this.orchestrator.runWorkflow(goal, taskSteps, rootPath, baseUrl, apiKey);

      return {
        status: 'Workflow started',
        goal,
        total_steps: taskSteps.length,
        execution_model: 'STRICT_SERIAL',
        initial_order: taskSteps.map((s, i) => `${i + 1}. ${s.roleName}: ${s.taskName}`),
        note: 'Execution has started serially. You can check status anytime with check_workflow_status.'
      };
    } else if (name === 'cancel_workflow') {
      this.orchestrator.cancel();
      return {
        status: 'cancelled',
        message: 'The running workflow and all active roles have been immediately cancelled.'
      };
    } else if (name === 'pause_workflow') {
      this.orchestrator.pause();
      return {
        status: 'paused',
        message: 'The workflow execution has been paused.'
      };
    } else if (name === 'resume_workflow') {
      this.orchestrator.resume();
      return {
        status: 'resumed',
        message: 'The workflow execution has been resumed.'
      };
    } else if (name === 'check_router_status') {
      const { baseUrl, apiKey } = this.getSettings();
      const status = await check9RouterStatus(baseUrl, apiKey, 3000);
      return {
        online: status.online,
        baseUrl,
        error: status.error,
        message: status.online
          ? '9Router is running and reachable in the background.'
          : `9Router is not running in the background: ${status.error || 'Connection refused'}. Please start 9Router.`
      };
    } else if (name === 'check_workflow_status') {
      const wf = this.orchestrator.workflow;
      if (!wf) {
        return { status: 'idle', message: 'No workflow is currently running or queued.' };
      }

      const activeStep = wf.steps[wf.activeStepIndex];
      return {
        workflow_status: wf.status,
        goal: wf.userGoal,
        active_role: activeStep ? activeStep.roleName : 'None',
        active_task: activeStep ? activeStep.taskName : 'None',
        active_model: activeStep ? activeStep.assignedModel : 'None',
        active_progress: activeStep ? activeStep.progressState : 'None',
        step_index: `${wf.activeStepIndex + 1}/${wf.steps.length}`,
        completed_steps: wf.steps.filter((s) => s.status === 'Completed').map((s) => s.roleName),
        queued_steps: wf.steps.filter((s) => s.status === 'Queued').map((s) => s.roleName),
        fallbacks_occurred: wf.steps.flatMap((s) => s.fallbackHistory).length
      };
    } else if (name === 'modify_workflow') {
      const action = args.action;
      if (action === 'pause') {
        this.orchestrator.pause();
        return { result: 'Workflow paused' };
      } else if (action === 'resume') {
        this.orchestrator.resume();
        return { result: 'Workflow resumed' };
      } else if (action === 'cancel') {
        this.orchestrator.cancel();
        return { result: 'Workflow cancelled' };
      } else if (action === 'repeat_step') {
        const wf = this.orchestrator.workflow;
        if (!wf) return { error: 'No active workflow to repeat step from.' };
        const stepToRepeat = (args.step_id ? wf.steps.find((s) => s.id === args.step_id) : undefined)
          ?? (typeof args.position === 'number' && wf.steps[args.position - 1])
          ?? wf.steps[Math.max(0, wf.activeStepIndex - 1)];
        if (!stepToRepeat) return { error: 'Target step to repeat not found.' };

        const repeatedStep: TaskStep = {
          id: `step_${Date.now()}_repeat`,
          roleId: stepToRepeat.roleId,
          roleName: stepToRepeat.roleName,
          taskName: `${stepToRepeat.taskName} (Repeat)`,
          taskPrompt: String(args.task_prompt || stepToRepeat.taskPrompt),
          temporaryInstructions: args.special_instructions ? String(args.special_instructions) : 'Re-running step with updated instructions',
          status: 'Queued',
          progressState: 'Waiting',
          assignedModel: stepToRepeat.assignedModel,
          fallbackHistory: [],
          filesChanged: []
        };
        this.orchestrator.appendStep(repeatedStep);
        return { result: `Re-queued step '${repeatedStep.taskName}' to execute next serially.` };
      } else if (action === 'insert_step' || action === 'append_step') {
        const roleId = String(args.role_id || 'backend').toLowerCase();
        const roleDef = getRole(roleId, this.context) || getRole('backend', this.context)!;
        const newStep: TaskStep = {
          id: `step_${Date.now()}`,
          roleId: roleDef.id,
          roleName: roleDef.name,
          taskName: String(args.task_name || `Additional Task`),
          taskPrompt: String(args.task_prompt || ''),
          temporaryInstructions: args.special_instructions ? String(args.special_instructions) : undefined,
          status: 'Queued',
          progressState: 'Waiting',
          assignedModel: roleDef.primaryModel,
          fallbackHistory: [],
          filesChanged: []
        };

        if (action === 'insert_step') {
          const pos = typeof args.position === 'number' ? Math.max(0, args.position - 1) : 0;
          this.orchestrator.insertStep(pos, newStep);
          return { result: `Inserted step '${newStep.taskName}' at position ${pos + 1}` };
        } else {
          this.orchestrator.appendStep(newStep);
          return { result: `Appended step '${newStep.taskName}' to workflow` };
        }
      }
    } else if (name === 'list_roles') {
      const roles = getRoles(this.context);
      const filePath = getWorkspaceRolesFilePath();
      return {
        status: 'success',
        total_roles: roles.length,
        roles_json_file: filePath || 'No workspace opened',
        roles: roles.map((r) => ({
          id: r.id,
          name: r.name,
          enabled: r.enabled,
          primary_model: r.primaryModel,
          fallback_models: r.fallbackModels,
          purpose: r.purpose,
          temperature: r.temperature,
          max_tokens: r.maxTokens
        }))
      };
    } else if (name === 'list_router_models') {
      const catalog = UnifiedModelCatalog.getInstance().getModels();
      const q = String(args.query || '').trim();
      const prov = String(args.provider || '').trim().toLowerCase();
      const cap = String(args.capability || 'all').trim().toLowerCase();
      const limit = typeof args.limit === 'number' && args.limit > 0 ? Math.min(args.limit, 100) : 25;

      let matched = q ? searchModels(q, catalog) : catalog;
      if (prov) {
        matched = matched.filter((m) => m.provider.toLowerCase().includes(prov) || m.id.toLowerCase().includes(prov));
      }
      if (cap === 'reasoning') matched = matched.filter((m) => m.caps.reasoning);
      else if (cap === 'tools' || cap === 'coding') matched = matched.filter((m) => m.caps.tools);
      else if (cap === 'vision') matched = matched.filter((m) => m.caps.vision);

      return {
        query: q || undefined,
        provider: prov || undefined,
        total_matched: matched.length,
        returned_count: Math.min(matched.length, limit),
        models: matched.slice(0, limit).map((m) => ({
          id: m.id,
          provider: m.provider,
          source: m.source,
          context_window: m.caps.contextWindow,
          max_output: m.caps.maxOutput,
          capabilities: ['tools', 'reasoning', 'vision'].filter((k) => (m.caps as any)[k])
        }))
      };
    } else if (name === 'configure_role_models') {
      const assignments = Array.isArray(args.assignments) ? args.assignments : [];
      if (assignments.length === 0) {
        return { error: 'No assignments provided' };
      }
      const roles = getRoles(this.context);
      const updatedList: any[] = [];

      for (const a of assignments) {
        const roleId = String(a.role_id || '').toLowerCase().trim();
        const role = roles.find((r) => r.id.toLowerCase() === roleId);
        if (!role) continue;

        if (typeof a.primary_model === 'string' && a.primary_model.trim()) {
          role.primaryModel = a.primary_model.trim();
        }
        if (Array.isArray(a.fallback_models)) {
          role.fallbackModels = a.fallback_models.map((s: any) => String(s).trim()).filter(Boolean);
        }
        if (typeof a.enabled === 'boolean') {
          role.enabled = a.enabled;
        }
        updatedList.push({
          role_id: role.id,
          role_name: role.name,
          primary_model: role.primaryModel,
          fallback_models: role.fallbackModels,
          enabled: role.enabled
        });
      }

      await saveRoles(this.context, roles);
      WorkflowWebviewPanel.currentPanel?.sendState();

      const filePath = getWorkspaceRolesFilePath();
      return {
        status: 'success',
        message: `Updated ${updatedList.length} role(s) successfully. Saved to ${filePath || 'global configuration'}.`,
        roles_json_file: filePath,
        reason: args.reason,
        updated_roles: updatedList
      };
    } else if (name === 'auto_assign_best_models') {
      const catalog = UnifiedModelCatalog.getInstance().getModels();
      const currentRoles = getRoles(this.context);
      const strategy: AssignmentStrategy = (args.strategy as AssignmentStrategy) || 'quality';

      const { updatedRoles, result } = autoAssignBestModelsForRoles(currentRoles, catalog, strategy);
      await saveRoles(this.context, updatedRoles);
      WorkflowWebviewPanel.currentPanel?.sendState();

      const filePath = getWorkspaceRolesFilePath();
      return {
        status: 'success',
        strategy: result.strategy,
        summary: result.summary,
        roles_json_file: filePath,
        roles_modified: result.rolesModified,
        total_roles: result.totalRoles,
        assignments: result.recommendations.map((r) => ({
          role: r.roleName,
          role_id: r.roleId,
          primary_model: r.newPrimary,
          fallback_models: r.newFallbacks,
          rationale: r.reason
        }))
      };
    } else if (name === 'sync_roles_json') {
      const action = String(args.action || '').trim();
      const filePath = getWorkspaceRolesFilePath();
      if (action === 'reload_from_file') {
        const fileRoles = readRolesFromWorkspaceFile();
        if (!fileRoles) {
          return { error: `Cannot reload: ${filePath || '.antigravity/roles.json'} not found or invalid.` };
        }
        await saveRoles(this.context, fileRoles);
        WorkflowWebviewPanel.currentPanel?.sendState();
        return { status: 'success', message: `Reloaded ${fileRoles.length} roles from ${filePath}.`, total_roles: fileRoles.length };
      } else if (action === 'save_to_file') {
        const roles = getRoles(this.context);
        const savedPath = writeRolesToWorkspaceFile(roles);
        return { status: 'success', message: `Saved ${roles.length} roles to ${savedPath}.`, file_path: savedPath };
      } else if (action === 'get_json_content') {
        const jsonStr = exportRolesToJson();
        return { status: 'success', file_path: filePath, json_content: jsonStr };
      }
      return { error: `Unknown action: ${action}` };
    } else if (name === 'get_extension_settings') {
      const rCfg = vscode.workspace.getConfiguration('antigravity.router');
      const vCfg = vscode.workspace.getConfiguration('antigravity.voice');
      const sCfg = vscode.workspace.getConfiguration('antigravity.session');
      return {
        router: {
          baseUrl: rCfg.get<string>('baseUrl', 'http://127.0.0.1:20128/v1')
        },
        voice: {
          liveModel: vCfg.get<string>('liveModel', 'gemini-3.1-flash-live-preview'),
          ttsVoice: vCfg.get<string>('ttsVoice', 'Kore'),
          echoCancellation: vCfg.get<boolean>('echoCancellation', true)
        },
        session: {
          temperature: sCfg.get<number>('temperature', 0.5),
          maxTokens: sCfg.get<number>('maxTokens', 4096),
          allowShell: sCfg.get<boolean>('allowShell', true),
          allowVscode: sCfg.get<boolean>('allowVscode', true),
          allowFiles: sCfg.get<boolean>('allowFiles', true)
        }
      };
    } else if (name === 'update_extension_settings') {
      const target = vscode.ConfigurationTarget.Global;
      const updates: Record<string, any> = {};
      if (typeof args.router_base_url === 'string' && args.router_base_url.trim()) {
        await vscode.workspace.getConfiguration('antigravity.router').update('baseUrl', args.router_base_url.trim(), target);
        updates.router_base_url = args.router_base_url.trim();
      }
      if (typeof args.live_model === 'string' && args.live_model.trim()) {
        await vscode.workspace.getConfiguration('antigravity.voice').update('liveModel', args.live_model.trim(), target);
        updates.live_model = args.live_model.trim();
      }
      if (typeof args.temperature === 'number') {
        await vscode.workspace.getConfiguration('antigravity.session').update('temperature', args.temperature, target);
        updates.temperature = args.temperature;
      }
      if (typeof args.max_tokens === 'number') {
        await vscode.workspace.getConfiguration('antigravity.session').update('maxTokens', args.max_tokens, target);
        updates.max_tokens = args.max_tokens;
      }
      if (typeof args.allow_shell === 'boolean') {
        await vscode.workspace.getConfiguration('antigravity.session').update('allowShell', args.allow_shell, target);
        updates.allow_shell = args.allow_shell;
      }
      if (typeof args.allow_files === 'boolean') {
        await vscode.workspace.getConfiguration('antigravity.session').update('allowFiles', args.allow_files, target);
        updates.allow_files = args.allow_files;
      }
      WorkflowWebviewPanel.currentPanel?.sendState();
      return { status: 'success', message: 'Settings updated successfully.', applied_updates: updates };
    }

    return { error: `Unknown orchestration tool: ${name}` };
  }
}
