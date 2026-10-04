import { ToolPolicy } from '../chat';

export type TaskStatus =
  | 'Pending'
  | 'Queued'
  | 'Running'
  | 'Waiting'
  | 'Completed'
  | 'Failed'
  | 'Retrying'
  | 'Fallback'
  | 'Cancelled'
  | 'Skipped';

export type ProgressState =
  | 'Analyzing'
  | 'Planning'
  | 'Editing'
  | 'Testing'
  | 'Verifying'
  | 'Waiting'
  | 'Idle';

export interface RoleDefinition {
  id: string;
  name: string;
  description: string;
  purpose: string;
  systemPrompt: string; // Permanent Role System Prompt
  primaryModel: string;
  fallbackModels: string[]; // Ordered list of fallback models
  enabled: boolean;
  toolPermissions: ToolPolicy;
  projectAccess: {
    fullWorkspace: boolean;
    allowedPaths?: string[];
  };
  temperature?: number;
  maxTokens?: number;
  icon?: string;
  isCustom?: boolean;
}

export interface FallbackEvent {
  timestamp: number;
  roleId: string;
  taskStepId: string;
  fromModel: string;
  toModel: string;
  reason: string;
  isPermanentFailure: boolean;
}

export interface ContextHandoff {
  completedStepId: string;
  roleId: string;
  roleName: string;
  taskName: string;
  summary: string;
  filesChanged: string[];
  contractsAndApis: string[];
  keyDecisions: string[];
  knownIssues: string[];
  warnings: string[];
  timestamp: number;
}

export interface TaskStep {
  id: string;
  roleId: string;
  roleName: string;
  taskName: string;
  taskPrompt: string; // Current Task Prompt (distinct from System Prompt)
  temporaryInstructions?: string;
  dependencies?: string[]; // IDs of preceding steps this depends on
  status: TaskStatus;
  progressState: ProgressState;
  progressPercent?: number;
  assignedModel: string;
  originalModel?: string;
  modelChangeReason?: string;
  fallbackHistory: FallbackEvent[];
  startTime?: number;
  endTime?: number;
  resultSummary?: string;
  filesChanged: string[];
  error?: string;
  outputLog?: string[];
}

export interface WorkflowState {
  id: string;
  userGoal: string;
  steps: TaskStep[];
  activeStepIndex: number;
  status: 'Idle' | 'Planning' | 'Running' | 'Paused' | 'Completed' | 'Failed' | 'Cancelled';
  startTime?: number;
  endTime?: number;
  verificationResult?: {
    verified: boolean;
    summary: string;
    checksPassed: string[];
    issuesFound: string[];
    additionalRolesNeeded?: string[];
  };
  contextHandoffs: ContextHandoff[];
}
