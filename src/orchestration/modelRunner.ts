import * as vscode from 'vscode';
import { streamCompletion, executeTools, hasToolBlocks, ANTIGRAVITY_TOOLS, ChatMessage, NativeToolCall } from '../chat';
import { RoleDefinition, TaskStep, FallbackEvent, ProgressState } from '../roles/types';
import { SharedProjectState } from './sharedState';

export interface RunnerCallbacks {
  onProgress(state: ProgressState, percent?: number, note?: string): void;
  onFallback(event: FallbackEvent): void;
  onLog(line: string): void;
}

export interface ExecutionResult {
  success: boolean;
  finalOutput: string;
  filesChanged: string[];
  contractsDiscovered: Array<{ name: string; spec: string }>;
  decisionsMade: string[];
  issuesIdentified: string[];
  error?: string;
}

/**
 * Classifies whether an error is temporary (should retry same model)
 * or persistent/unrecoverable (should fallback to next model in chain).
 */
export function isTemporaryError(err: unknown): boolean {
  const msg = (err instanceof Error ? err.message : String(err)).toLowerCase();

  // Network / Socket drops
  if (
    msg.includes('econnreset') ||
    msg.includes('etimedout') ||
    msg.includes('econnrefused') ||
    msg.includes('socket hang up') ||
    msg.includes('network error') ||
    msg.includes('fetch failed') ||
    msg.includes('timeout')
  ) {
    return true;
  }

  // Transient HTTP 5xx codes
  if (
    msg.includes('http 500') ||
    msg.includes('http 502') ||
    msg.includes('http 503') ||
    msg.includes('http 504') ||
    msg.includes('internal server error') ||
    msg.includes('bad gateway') ||
    msg.includes('gateway timeout') ||
    msg.includes('service unavailable')
  ) {
    return true;
  }

  // Transient rate limit spikes without explicit hard quota exhaustion
  if (msg.includes('rate limit') && !msg.includes('quota') && !msg.includes('exceeded your current quota')) {
    return true;
  }

  return false;
}

export function isPersistentError(err: unknown): boolean {
  const msg = (err instanceof Error ? err.message : String(err)).toLowerCase();

  // Quota completely exhausted
  if (
    msg.includes('quota') ||
    msg.includes('resource_exhausted') ||
    msg.includes('insufficient_quota') ||
    msg.includes('credit limit') ||
    msg.includes('balance') ||
    msg.includes('exceeded your current quota')
  ) {
    return true;
  }

  // Model not found or unavailable
  if (
    msg.includes('http 404') ||
    msg.includes('model not found') ||
    msg.includes('does not exist') ||
    msg.includes('unsupported model')
  ) {
    return true;
  }

  // Provider auth or disabled
  if (
    msg.includes('http 401') ||
    msg.includes('http 403') ||
    msg.includes('unauthorized') ||
    msg.includes('forbidden') ||
    msg.includes('invalid_api_key') ||
    msg.includes('permission denied')
  ) {
    return true;
  }

  // Model capability mismatch (e.g. tool calling completely unsupported after retry)
  if (msg.includes('does not support tools') || msg.includes('tool use is not supported')) {
    return true;
  }

  return false;
}

/**
 * Runs a single specialized role task using 9 Router.
 * Handles intelligent retries for temporary errors, and transparent fallbacks
 * across the role's configured fallback models while PRESERVING conversation context.
 */
export async function executeRoleTask(
  baseUrl: string,
  apiKey: string | undefined,
  role: RoleDefinition,
  step: TaskStep,
  sharedState: SharedProjectState,
  allSteps: TaskStep[],
  callbacks: RunnerCallbacks,
  maxRounds: number = 15
): Promise<ExecutionResult> {
  const candidateModels = [role.primaryModel, ...(role.fallbackModels || [])];
  let modelIndex = 0;

  // Build the permanent System Prompt & structured Shared Context
  const contextBlock = sharedState.buildContextForRole(role, step, allSteps);
  const fullSystemPrompt = [
    `=== PERMANENT ROLE SYSTEM PROMPT: ${role.name.toUpperCase()} ===`,
    role.systemPrompt.trim(),
    '',
    contextBlock
  ].join('\n');

  // Build the initial task prompt message (Role System Prompt vs Task Prompt clearly separated!)
  const initialTaskMessage = [
    `=== CURRENT TASK INSTRUCTIONS ===`,
    `Task Name: ${step.taskName}`,
    `Assigned Role: ${role.name}`,
    '',
    `Task Prompt:`,
    step.taskPrompt.trim(),
    '',
    step.temporaryInstructions
      ? `Main AI Special Instructions:\n${step.temporaryInstructions.trim()}\n`
      : '',
    `Directives:`,
    `1. Execute your task methodically using workspace tools (grep_search, view_file, write_to_file, replace_file_content, run_command, etc.).`,
    `2. If editing code, verify changes by compiling or running tests if applicable.`,
    `3. When completed, conclude with a concise summary of changes made, files modified, contracts established, and key decisions for subsequent roles.`
  ].join('\n');

  // Messages preserved across fallback events!
  const conversationMessages: ChatMessage[] = [
    { role: 'system', content: fullSystemPrompt },
    { role: 'user', content: initialTaskMessage }
  ];

  const changedFiles = new Set<string>();
  const discoveredContracts: Array<{ name: string; spec: string }> = [];
  const decisions: string[] = [];
  const issues: string[] = [];
  let finalAssistantReply = '';

  const roots = [sharedState.workspaceRoot];
  const policy = role.toolPermissions || { allowShell: true, allowVscode: true, allowFiles: true };

  // Loop across fallback model chain
  while (modelIndex < candidateModels.length) {
    const currentModel = candidateModels[modelIndex];
    step.assignedModel = currentModel;
    callbacks.onProgress('Planning', undefined, `Running on ${currentModel}`);
    callbacks.onLog(`[role:${role.id}] executing with model: ${currentModel} (fallback priority #${modelIndex})`);

    let currentModelRounds = 0;
    let modelSuccess = false;
    let temporaryRetries = 0;
    const MAX_TEMP_RETRIES = 2;

    while (currentModelRounds < maxRounds) {
      currentModelRounds++;

      // Progress state estimation
      if (currentModelRounds === 1) {
        callbacks.onProgress('Analyzing', undefined, 'Analyzing task requirements');
      }

      let rawDelta = '';
      let streamError: unknown = null;
      let toolCalls: NativeToolCall[] = [];

      try {
        const response = await streamCompletion(
          {
            baseUrl,
            apiKey,
            model: currentModel,
            messages: conversationMessages,
            temperature: role.temperature ?? 0.2,
            maxTokens: role.maxTokens ?? 8192,
            tools: ANTIGRAVITY_TOOLS
          },
          (delta) => {
            rawDelta += delta;
          }
        );
        rawDelta = response.content;
        toolCalls = response.toolCalls;
      } catch (err) {
        streamError = err;
      }

      // Handle stream errors
      if (streamError) {
        const errMsg = streamError instanceof Error ? streamError.message : String(streamError);
        const temp = isTemporaryError(streamError);
        const perm = isPersistentError(streamError);

        if (temp && temporaryRetries < MAX_TEMP_RETRIES) {
          temporaryRetries++;
          callbacks.onProgress('Retrying' as ProgressState, undefined, `Temporary error (${errMsg.slice(0, 50)}) — retrying ${currentModel} (${temporaryRetries}/${MAX_TEMP_RETRIES})`);
          callbacks.onLog(`[retry] temporary error on ${currentModel}: ${errMsg} — backoff retry ${temporaryRetries}...`);
          await new Promise((r) => setTimeout(r, 1500 * temporaryRetries));
          continue; // Retry same model
        }

        // If not temporary or retries exhausted, trigger fallback
        callbacks.onLog(`[error] model ${currentModel} failed: ${errMsg}`);
        if (modelIndex < candidateModels.length - 1) {
          const nextModel = candidateModels[modelIndex + 1];
          const fallbackEvent: FallbackEvent = {
            timestamp: Date.now(),
            roleId: role.id,
            taskStepId: step.id,
            fromModel: currentModel,
            toModel: nextModel,
            reason: errMsg,
            isPermanentFailure: perm || temporaryRetries >= MAX_TEMP_RETRIES
          };
          step.fallbackHistory.push(fallbackEvent);
          callbacks.onFallback(fallbackEvent);
          callbacks.onProgress('Fallback' as ProgressState, undefined, `Switching from ${currentModel} to ${nextModel}`);
          callbacks.onLog(`[fallback] switching role ${role.name} model: ${currentModel} -> ${nextModel} (Reason: ${errMsg})`);

          modelIndex++;
          // Break out of current model round loop to start with next model in chain
          break;
        } else {
          // All fallback models exhausted!
          return {
            success: false,
            finalOutput: `All ${candidateModels.length} models for role ${role.name} failed. Last error: ${errMsg}`,
            filesChanged: Array.from(changedFiles),
            contractsDiscovered: discoveredContracts,
            decisionsMade: decisions,
            issuesIdentified: issues,
            error: errMsg
          };
        }
      }

      // Successful round completion from current model!
      temporaryRetries = 0;
      finalAssistantReply = rawDelta;

      const hasXml = hasToolBlocks(rawDelta);
      const hasNative = toolCalls && toolCalls.length > 0;

      if (!hasXml && !hasNative) {
        // No tools requested — task completed!
        conversationMessages.push({ role: 'assistant', content: rawDelta });
        modelSuccess = true;
        break;
      }

      // Execute tools
      const toolNames = [
        ...toolCalls.map((c) => c.name),
        ...(rawDelta.match(/<antigravity:([a-z_]+)/g) || []).map((t) => t.slice(13))
      ];

      // Update progress state based on tool types
      if (toolNames.some((t) => t.includes('command') || t.includes('shell'))) {
        callbacks.onProgress('Testing', undefined, 'Compiling and verifying');
      } else if (toolNames.some((t) => t.includes('file') || t.includes('edit') || t.includes('write'))) {
        callbacks.onProgress('Editing', undefined, 'Modifying codebase');
      } else {
        callbacks.onProgress('Analyzing', undefined, 'Inspecting files and schemas');
      }

      callbacks.onLog(`[role:${role.id}] executing tools: ${toolNames.join(', ')}`);
      const results = await executeTools(rawDelta, roots, policy, toolCalls);

      // Track file modifications
      for (const r of results) {
        if ((r.tool === 'file' || r.tool === 'write_to_file') && r.output.startsWith('created')) {
          const match = r.output.match(/^created\s+(.+?)(?:\s+\(|$)/);
          const f = match ? match[1].trim() : r.args.trim();
          changedFiles.add(f);
          sharedState.recordFileChange(f, true);
        } else if (r.tool.includes('edit') || r.tool.includes('replace')) {
          if (r.output.includes('successfully edited')) {
            changedFiles.add(r.args.trim());
            sharedState.recordFileChange(r.args.trim(), false);
          }
        }
      }

      // Append assistant & tool responses to context
      if (hasNative) {
        conversationMessages.push({
          role: 'assistant',
          content: rawDelta,
          tool_calls: toolCalls.map((tc) => ({
            id: tc.id,
            type: 'function',
            function: {
              name: tc.name,
              arguments: JSON.stringify(tc.arguments)
            }
          }))
        });
        for (let i = 0; i < toolCalls.length; i++) {
          const tc = toolCalls[i];
          const tr = results[i];
          conversationMessages.push({
            role: 'tool',
            tool_call_id: tc.id,
            name: tc.name,
            content: tr ? tr.output : '[done]'
          });
        }
      } else {
        conversationMessages.push({ role: 'assistant', content: rawDelta });
        const feed = results
          .map((r) => `<antigravity:tool_result tool="${r.tool}" args="${r.args}">\n${r.output}\n</antigravity:tool_result>`)
          .join('\n');
        conversationMessages.push({ role: 'user', content: feed });
      }
    }

    if (modelSuccess) {
      // Role completed its rounds successfully!
      callbacks.onProgress('Verifying', undefined, 'Synthesizing output and handoff state');

      // Extract contracts / decisions from finalAssistantReply
      const lines = finalAssistantReply.split('\n');
      for (const l of lines) {
        if (l.match(/^(?:POST|GET|PUT|DELETE|PATCH)\s+\/|endpoint:|route:/i)) {
          discoveredContracts.push({ name: l.trim(), spec: l.trim() });
          sharedState.recordContract(l.trim(), l.trim());
        }
        if (l.match(/decision:|architectural choice:|note:/i)) {
          decisions.push(l.trim());
        }
        if (l.match(/warning:|known issue:|todo:/i)) {
          issues.push(l.trim());
        }
      }

      return {
        success: true,
        finalOutput: finalAssistantReply,
        filesChanged: Array.from(changedFiles),
        contractsDiscovered: discoveredContracts,
        decisionsMade: decisions,
        issuesIdentified: issues
      };
    }
  }

  return {
    success: false,
    finalOutput: 'Task did not reach completion within allowed tool rounds.',
    filesChanged: Array.from(changedFiles),
    contractsDiscovered: discoveredContracts,
    decisionsMade: decisions,
    issuesIdentified: issues,
    error: 'Exceeded maximum execution rounds'
  };
}
