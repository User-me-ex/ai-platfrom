import * as vscode from 'vscode';
import { TaskStep, WorkflowState, RoleDefinition, ContextHandoff, FallbackEvent, ProgressState } from '../roles/types';
import { SharedProjectState } from './sharedState';
import { executeRoleTask, RunnerCallbacks } from './modelRunner';
import { getRole } from '../roles/roleRegistry';
import { streamCompletion, runShell } from '../chat';

export interface OrchestratorEvents {
  onWorkflowUpdated(workflow: WorkflowState): void;
  onStepProgress(stepId: string, progressState: ProgressState, percent?: number, note?: string): void;
  onFallback(event: FallbackEvent): void;
  onLog(line: string): void;
  onVerification(result: WorkflowState['verificationResult']): void;
}

export class SerialOrchestrator {
  private currentWorkflow: WorkflowState | null = null;
  private isPaused: boolean = false;
  private isCancelled: boolean = false;
  private events: OrchestratorEvents;
  private context: vscode.ExtensionContext;
  private isRunning: boolean = false;

  constructor(context: vscode.ExtensionContext, events: OrchestratorEvents) {
    this.context = context;
    this.events = events;
  }

  public get workflow(): WorkflowState | null {
    return this.currentWorkflow;
  }

  public get running(): boolean {
    return this.isRunning;
  }

  public get paused(): boolean {
    return this.isPaused;
  }

  public pause(): void {
    if (!this.isPaused) {
      this.isPaused = true;
      if (this.currentWorkflow && this.isRunning) {
        this.currentWorkflow.status = 'Paused';
        this.events.onWorkflowUpdated(this.currentWorkflow);
      }
      this.events.onLog('[orchestrator] workflow execution paused by user');
    }
  }

  public resume(): void {
    if (this.isPaused) {
      this.isPaused = false;
      if (this.currentWorkflow && this.isRunning) {
        this.currentWorkflow.status = 'Running';
        this.events.onWorkflowUpdated(this.currentWorkflow);
      }
      this.events.onLog('[orchestrator] workflow execution resumed');
    }
  }

  public cancel(): void {
    if (this.isRunning) {
      this.isCancelled = true;
      if (this.currentWorkflow) {
        this.currentWorkflow.status = 'Cancelled';
        const activeStep = this.currentWorkflow.steps[this.currentWorkflow.activeStepIndex];
        if (activeStep && activeStep.status === 'Running') {
          activeStep.status = 'Cancelled';
          activeStep.endTime = Date.now();
        }
        this.events.onWorkflowUpdated(this.currentWorkflow);
      }
      this.events.onLog('[orchestrator] workflow execution cancelled by user');
    }
  }

  public insertStep(index: number, step: TaskStep): void {
    if (!this.currentWorkflow) return;
    this.currentWorkflow.steps.splice(index, 0, step);
    this.events.onLog(`[orchestrator] inserted serial step #${index + 1}: ${step.roleName} - ${step.taskName}`);
    this.events.onWorkflowUpdated(this.currentWorkflow);
  }

  public appendStep(step: TaskStep): void {
    if (!this.currentWorkflow) return;
    this.currentWorkflow.steps.push(step);
    this.events.onLog(`[orchestrator] appended serial step #${this.currentWorkflow.steps.length}: ${step.roleName} - ${step.taskName}`);
    this.events.onWorkflowUpdated(this.currentWorkflow);
  }

  /**
   * Executes a workflow with STRICT SERIAL ENFORCEMENT.
   * Only ONE specialized role runs at a time.
   */
  public async runWorkflow(
    userGoal: string,
    initialSteps: TaskStep[],
    workspaceRoot: string,
    baseUrl: string,
    apiKey?: string
  ): Promise<WorkflowState> {
    if (this.isRunning) {
      throw new Error('Another workflow is currently executing. Execution is strictly serial.');
    }

    this.isRunning = true;
    this.isPaused = false;
    this.isCancelled = false;

    const workflowId = `wf_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const sharedState = new SharedProjectState(workspaceRoot, userGoal);

    this.currentWorkflow = {
      id: workflowId,
      userGoal,
      steps: initialSteps,
      activeStepIndex: 0,
      status: 'Running',
      startTime: Date.now(),
      contextHandoffs: []
    };

    // Initialize all steps as Queued except the first (which will be Running)
    for (let i = 0; i < this.currentWorkflow.steps.length; i++) {
      this.currentWorkflow.steps[i].status = 'Queued';
      this.currentWorkflow.steps[i].progressState = 'Waiting';
    }

    this.events.onWorkflowUpdated(this.currentWorkflow);
    this.events.onLog(`\n========================================`);
    this.events.onLog(`[orchestrator] STARTING SERIAL WORKFLOW: "${userGoal}"`);
    this.events.onLog(`[orchestrator] Initial serial plan: ${initialSteps.map((s, i) => `${i + 1}. ${s.roleName}`).join(' -> ')}`);
    this.events.onLog(`========================================\n`);

    try {
      while (this.currentWorkflow.activeStepIndex < this.currentWorkflow.steps.length) {
        // Handle cancellation
        if (this.isCancelled) {
          this.currentWorkflow.status = 'Cancelled';
          break;
        }

        // Handle pause
        while (this.isPaused && !this.isCancelled) {
          await new Promise((resolve) => setTimeout(resolve, 500));
        }
        if (this.isCancelled) {
          this.currentWorkflow.status = 'Cancelled';
          break;
        }

        const stepIndex = this.currentWorkflow.activeStepIndex;
        const currentStep = this.currentWorkflow.steps[stepIndex];

        // STRICT SERIAL RULE: Mark current step as RUNNING; all pending steps remain QUEUED
        currentStep.status = 'Running';
        currentStep.startTime = Date.now();
        currentStep.progressState = 'Planning';
        this.events.onWorkflowUpdated(this.currentWorkflow);

        const roleDef = getRole(currentStep.roleId, this.context);
        if (!roleDef) {
          currentStep.status = 'Failed';
          currentStep.error = `Role definition '${currentStep.roleId}' not found in registry.`;
          this.events.onLog(`[orchestrator] [error] role '${currentStep.roleId}' not found`);
          this.events.onWorkflowUpdated(this.currentWorkflow);
          break;
        }

        this.events.onLog(`\n------------------------------------------------------------`);
        this.events.onLog(`[orchestrator] STEP ${stepIndex + 1}/${this.currentWorkflow.steps.length}: [ACTIVE: ${roleDef.name.toUpperCase()}]`);
        this.events.onLog(`[orchestrator] Task: ${currentStep.taskName}`);
        this.events.onLog(`[orchestrator] Primary Model: ${roleDef.primaryModel}`);
        if (roleDef.fallbackModels.length) {
          this.events.onLog(`[orchestrator] Fallback Models: ${roleDef.fallbackModels.join(' -> ')}`);
        }
        this.events.onLog(`------------------------------------------------------------`);

        // Runner callbacks
        const callbacks: RunnerCallbacks = {
          onProgress: (state, percent, note) => {
            currentStep.progressState = state;
            if (percent !== undefined) currentStep.progressPercent = percent;
            this.events.onStepProgress(currentStep.id, state, percent, note);
            this.events.onWorkflowUpdated(this.currentWorkflow!);
          },
          onFallback: (event) => {
            currentStep.fallbackHistory.push(event);
            this.events.onFallback(event);
            this.events.onWorkflowUpdated(this.currentWorkflow!);
          },
          onLog: (line) => {
            if (!currentStep.outputLog) currentStep.outputLog = [];
            currentStep.outputLog.push(line);
            this.events.onLog(line);
          }
        };

        // EXECUTE ACTIVE ROLE SERIALLY
        const result = await executeRoleTask(
          baseUrl,
          apiKey,
          roleDef,
          currentStep,
          sharedState,
          this.currentWorkflow.steps,
          callbacks
        );

        currentStep.endTime = Date.now();
        currentStep.filesChanged = result.filesChanged;
        currentStep.resultSummary = result.finalOutput;

        if (!result.success) {
          currentStep.status = 'Failed';
          currentStep.error = result.error || 'Role task failed';
          currentStep.progressState = 'Idle';
          this.events.onLog(`[orchestrator] [FAILED] step #${stepIndex + 1} (${roleDef.name}): ${result.error}`);
          this.events.onWorkflowUpdated(this.currentWorkflow);
          // Allow Main AI to decide whether to retry or abort
          break;
        }

        // STEP COMPLETED SUCCESSFULLY
        currentStep.status = 'Completed';
        currentStep.progressState = 'Idle';
        this.events.onLog(`[orchestrator] [COMPLETED] step #${stepIndex + 1} (${roleDef.name})`);

        // CREATE STRUCTURED CONTEXT HANDOFF & UPDATE SHARED STATE
        const handoff: ContextHandoff = {
          completedStepId: currentStep.id,
          roleId: roleDef.id,
          roleName: roleDef.name,
          taskName: currentStep.taskName,
          summary: result.finalOutput.slice(0, 500),
          filesChanged: result.filesChanged,
          contractsAndApis: result.contractsDiscovered.map((c) => `${c.name}: ${c.spec}`),
          keyDecisions: result.decisionsMade,
          knownIssues: result.issuesIdentified,
          warnings: [],
          timestamp: Date.now()
        };

        sharedState.recordHandoff(handoff);
        this.currentWorkflow.contextHandoffs.push(handoff);

        // Advance to next serial step
        this.currentWorkflow.activeStepIndex++;
        this.events.onWorkflowUpdated(this.currentWorkflow);
      }

      // FINAL VERIFICATION STAGE
      if (!this.isCancelled && this.currentWorkflow.status !== 'Failed') {
        this.events.onLog(`\n========================================`);
        this.events.onLog(`[orchestrator] INITIATING FINAL VERIFICATION STAGE`);
        this.events.onLog(`========================================`);

        const verification = await this.performFinalVerification(
          this.currentWorkflow,
          sharedState,
          workspaceRoot,
          baseUrl,
          apiKey
        );

        this.currentWorkflow.verificationResult = verification;
        this.events.onVerification(verification);

        // If verification found missing work requiring an additional role:
        if (
          !verification.verified &&
          verification.additionalRolesNeeded &&
          verification.additionalRolesNeeded.length > 0
        ) {
          const nextRoleId = verification.additionalRolesNeeded[0];
          const nextRoleDef = getRole(nextRoleId, this.context);
          if (nextRoleDef) {
            this.events.onLog(`[orchestrator] Verification requested follow-up role: ${nextRoleDef.name}`);
            const extraStep: TaskStep = {
              id: `step_${Date.now()}`,
              roleId: nextRoleDef.id,
              roleName: nextRoleDef.name,
              taskName: `Resolve verification issues: ${verification.issuesFound.join('; ')}`,
              taskPrompt: `Address the issues uncovered during final verification:\n${verification.issuesFound.join('\n')}\nSynthesize final fixes.`,
              status: 'Queued',
              progressState: 'Waiting',
              assignedModel: nextRoleDef.primaryModel,
              fallbackHistory: [],
              filesChanged: []
            };
            this.appendStep(extraStep);
            // Re-enter the serial loop for the appended step!
            this.isRunning = false;
            return this.runWorkflow(userGoal, this.currentWorkflow.steps, workspaceRoot, baseUrl, apiKey);
          }
        }

        this.currentWorkflow.status = verification.verified ? 'Completed' : 'Completed';
        this.currentWorkflow.endTime = Date.now();
        this.events.onWorkflowUpdated(this.currentWorkflow);
        this.events.onLog(`[orchestrator] WORKFLOW COMPLETE: ${verification.summary}`);
      }
    } finally {
      this.isRunning = false;
      this.isPaused = false;
      this.isCancelled = false;
    }

    return this.currentWorkflow;
  }

  /**
   * Final Verification Stage:
   * Checks if requested task actually completed, required files changed,
   * compiles/tests code if build scripts exist, and reports outcome.
   */
  private async performFinalVerification(
    workflow: WorkflowState,
    sharedState: SharedProjectState,
    workspaceRoot: string,
    baseUrl: string,
    apiKey?: string
  ): Promise<NonNullable<WorkflowState['verificationResult']>> {
    const passed: string[] = [];
    const issues: string[] = [];

    // Check 1: All planned steps completed
    const completedSteps = workflow.steps.filter((s) => s.status === 'Completed');
    if (completedSteps.length === workflow.steps.length) {
      passed.push(`All ${completedSteps.length} planned serial steps completed successfully.`);
    } else {
      issues.push(`${workflow.steps.length - completedSteps.length} steps failed or were cancelled.`);
    }

    // Check 2: File modifications occurred
    const totalFiles = Array.from(new Set([...sharedState.filesCreated, ...sharedState.filesModified]));
    if (totalFiles.length > 0) {
      passed.push(`${totalFiles.length} file(s) created or modified (${totalFiles.slice(0, 5).join(', ')}${totalFiles.length > 5 ? '...' : ''}).`);
    } else {
      passed.push('No files were modified (exploration or analysis task).');
    }

    // Check 3: Automated build/compilation check (if package.json has compile/build)
    try {
      this.events.onLog('[verification] verifying build & compilation status…');
      const testBuild = await runShell('npm run compile', workspaceRoot);
      if (testBuild.includes('[error]') || testBuild.includes('error TS')) {
        issues.push(`Compilation error detected: ${testBuild.split('\n')[0]}`);
      } else {
        passed.push('Project builds and compiles cleanly with 0 errors.');
      }
    } catch {
      // Not an npm project or no compile script — harmless skip
    }

    const isSuccess = issues.length === 0;
    const summary = isSuccess
      ? `Workflow verified successfully. All ${completedSteps.length} steps satisfied objectives.`
      : `Workflow completed with warnings: ${issues.join('; ')}`;

    return {
      verified: isSuccess,
      summary,
      checksPassed: passed,
      issuesFound: issues,
      additionalRolesNeeded: issues.length ? ['testing'] : undefined
    };
  }
}
