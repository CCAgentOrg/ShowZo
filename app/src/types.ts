// Re-export pipeline types for the UI layer.
// Pipeline types live at pipeline/types.ts — this file keeps the UI
// decoupled from the pipeline module shape.

export interface StepView {
  id: string;
  order: number;
  action: string;
  target?: string;
  value?: string | number;
  narration?: string;
}

export interface PlanResponse {
  title: string;
  url: string;
  steps: StepView[];
  metadata?: {
    estimatedDuration?: number;
  };
}

export interface PlanRequest {
  url: string;
  scenario: string;
}

export interface ApiError {
  error: string;
}

export type SessionStatus =
  | "planning"
  | "approved"
  | "recording"
  | "assembling"
  | "complete"
  | "failed";

export interface SessionView {
  id: string;
  url: string;
  status: SessionStatus;
  createdAt: number;
  error?: string;
}
