import * as path from 'path';
import { ContextHandoff, RoleDefinition, TaskStep } from '../roles/types';

export class SharedProjectState {
  public readonly workspaceRoot: string;
  public readonly userGoal: string;
  public filesModified: Set<string> = new Set();
  public filesCreated: Set<string> = new Set();
  public handoffs: ContextHandoff[] = [];
  public contractsAndEndpoints: Map<string, string> = new Map();
  public architectureNotes: string[] = [];
  public knownIssues: string[] = [];
  public startTime: number;

  constructor(workspaceRoot: string, userGoal: string) {
    this.workspaceRoot = workspaceRoot;
    this.userGoal = userGoal;
    this.startTime = Date.now();
  }

  public recordFileChange(filePath: string, created: boolean = false): void {
    const rel = path.isAbsolute(filePath) ? path.relative(this.workspaceRoot, filePath) : filePath;
    if (created) {
      this.filesCreated.add(rel);
    } else {
      this.filesModified.add(rel);
    }
  }

  public recordContract(nameOrRoute: string, specification: string): void {
    this.contractsAndEndpoints.set(nameOrRoute, specification);
  }

  public recordHandoff(handoff: ContextHandoff): void {
    this.handoffs.push(handoff);
    for (const f of handoff.filesChanged) {
      this.recordFileChange(f);
    }
    for (const c of handoff.contractsAndApis) {
      this.architectureNotes.push(`[Contract] ${c}`);
    }
    for (const d of handoff.keyDecisions) {
      this.architectureNotes.push(`[Decision] ${d}`);
    }
    for (const issue of handoff.knownIssues) {
      if (!this.knownIssues.includes(issue)) {
        this.knownIssues.push(issue);
      }
    }
  }

  /**
   * Builds high-signal, structured context for the next serial role.
   * Avoids token bloat while giving the role complete awareness of prior work.
   */
  public buildContextForRole(
    nextRole: RoleDefinition,
    currentStep: TaskStep,
    allSteps: TaskStep[]
  ): string {
    const lines: string[] = [];

    lines.push(`=== SHARED PROJECT STATE & CONTEXT HANDOFF ===`);
    lines.push(`Overall User Goal: ${this.userGoal}`);
    lines.push(`Current Active Role: ${nextRole.name} (${nextRole.id})`);
    lines.push(`Assigned Task: ${currentStep.taskName}`);
    lines.push(`Workspace Root: ${this.workspaceRoot}`);
    lines.push(`Role Project Access: Full workspace read access is enabled. You can inspect any file across the project.`);

    // List completed steps before this one
    const completed = allSteps.filter((s) => s.status === 'Completed');
    if (completed.length > 0) {
      lines.push(`\n--- PREVIOUSLY COMPLETED SERIAL STEPS (${completed.length}) ---`);
      for (const step of completed) {
        lines.push(`- [✓ Completed] ${step.roleName}: ${step.taskName}`);
        if (step.resultSummary) {
          lines.push(`  Summary: ${step.resultSummary.split('\n')[0]}`);
        }
        if (step.filesChanged.length > 0) {
          lines.push(`  Files Changed: ${step.filesChanged.join(', ')}`);
        }
      }
    }

    // List all files changed / created across the entire workflow so far
    const allFiles = Array.from(new Set([...this.filesCreated, ...this.filesModified]));
    if (allFiles.length > 0) {
      lines.push(`\n--- ALL FILES MODIFIED / CREATED SO FAR (${allFiles.length}) ---`);
      for (const f of allFiles) {
        const isNew = this.filesCreated.has(f);
        lines.push(`- ${f} (${isNew ? 'Created' : 'Modified'})`);
      }
      lines.push(`(Tip: Use view_file to inspect any of these files to ensure your work builds on the latest changes)`);
    }

    // Contracts and Endpoints
    if (this.contractsAndEndpoints.size > 0) {
      lines.push(`\n--- ESTABLISHED CONTRACTS & APIS ---`);
      for (const [route, spec] of this.contractsAndEndpoints.entries()) {
        lines.push(`- ${route}: ${spec}`);
      }
    }

    // Architecture notes & Key decisions
    if (this.architectureNotes.length > 0) {
      lines.push(`\n--- ARCHITECTURAL DECISIONS & SPECIFICATIONS ---`);
      for (const note of this.architectureNotes.slice(-10)) {
        lines.push(`- ${note}`);
      }
    }

    // Known issues or warnings for this role
    if (this.knownIssues.length > 0) {
      lines.push(`\n--- KNOWN ISSUES / WARNINGS ---`);
      for (const issue of this.knownIssues) {
        lines.push(`- [WARNING] ${issue}`);
      }
    }

    // Upcoming queued steps
    const queued = allSteps.filter((s) => s.status === 'Queued' && s.id !== currentStep.id);
    if (queued.length > 0) {
      lines.push(`\n--- SUBSEQUENT SERIAL STEPS WAITING IN QUEUE ---`);
      for (const q of queued) {
        lines.push(`- ${q.roleName}: ${q.taskName}`);
      }
    }

    lines.push(`\n=== END SHARED CONTEXT ===\n`);
    return lines.join('\n');
  }

  /**
   * Generates a comprehensive summary for the Final Verification stage.
   */
  public getSummaryForVerification(): string {
    const allFiles = Array.from(new Set([...this.filesCreated, ...this.filesModified]));
    return [
      `Overall Goal: ${this.userGoal}`,
      `Completed Steps: ${this.handoffs.length}`,
      `Total Files Modified/Created: ${allFiles.length} (${allFiles.join(', ') || 'None'})`,
      `Established Contracts: ${this.contractsAndEndpoints.size}`,
      `Active Issues: ${this.knownIssues.length ? this.knownIssues.join('; ') : 'None'}`
    ].join('\n');
  }
}
