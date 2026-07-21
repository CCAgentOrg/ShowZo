/** A single step in a walkthrough plan */
export interface Step {
  id: string;
  order: number;
  action: "navigate" | "click" | "type" | "scroll" | "wait" | "screenshot" | "hover" | "select" | "press" | "highlight";
  target?: string;
  value?: string | number;
  narration: string;
  /** Extra pause before this step (ms) */
  pauseMs?: number;
}

/** Plan returned by the AI plan generator */
export interface Plan {
  title: string;
  url: string;
  steps: Step[];
  metadata?: {
    estimatedDuration?: number;
  };
}

/** Status of a single recorded step */
export interface StepRecordState {
  id: string;
  order: number;
  action: string;
  narration: string;
  status: "pending" | "running" | "done" | "error";
  errorMessage?: string;
  screenshotPath?: string;
  narrationAudio?: string;
  narrationDuration?: number;
}

/** Full recording session state */
export interface Session {
  id: string;
  status: "created" | "recording" | "assembling" | "completed" | "failed";
  url: string;
  plan: Plan;
  steps: StepRecordState[];
  currentStep: number;
  totalSteps: number;
  elapsedMs: number;
  startedAt: number;
  completedAt?: number;
  finalVideo?: string;
  error?: string;
  log: string[];
}

/** Plan generation request */
export interface PlanRequest {
  url: string;
  scenario: string;
}

/** Plan generation response */
export interface PlanResponse {
  title: string;
  url: string;
  steps: Step[];
  metadata?: {
    estimatedDuration?: number;
  };
}

/** @deprecated use Plan */
export type ActionPlan = Plan;
/** @deprecated use Session */
export type RecordingSession = Session;
