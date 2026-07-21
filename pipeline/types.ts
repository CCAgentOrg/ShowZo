/** A single user-facing action in the walkthrough plan */
export interface Step {
  id: string;
  order: number;
  action: "navigate" | "click" | "type" | "scroll" | "wait" | "assert" | "hover" | "screenshot";
  /** CSS selector or agent-browser element reference (e.g. @e3) */
  target?: string;
  /** Value for type actions or scroll amount */
  value?: string | number;
  /** Optional description for narration generation */
  narration?: string;
  /** Expected outcome for assertions */
  expected?: string;
  /** Pause after this step (ms) */
  pauseMs?: number;
}

/** A narrated scene — a segment of the video with its own zoom target and narration */
export interface Scene {
  order: number;
  title: string;
  narration: string;
  duration: number; // seconds
  /** Where to zoom in (optional — if omitted, full-page view) */
  zoomTarget?: {
    x: number; y: number; width: number; height: number;
    /** Zoom scale (1 = no zoom, 2 = 2x) */
    scale: number;
  };
  /** Which steps this scene covers (by order) */
  stepRange?: [number, number];
  /** Cursor state at start of scene */
  cursorState?: {
    x: number; y: number; visible: boolean;
  };
}

/** The structured walkthrough plan */
export interface ActionPlan {
  title: string;
  url: string;
  steps: Step[];
  scenes: Scene[];
  metadata?: {
    pageTitle?: string;
    pageDescription?: string;
    keyElements?: string[];
    estimatedDuration?: number;
  };
}

/** Session state for a recording job */
export interface Session {
  id: string;
  url: string;
  status: "planning" | "approved" | "recording" | "assembling" | "complete" | "failed";
  plan?: ActionPlan;
  rawVideo?: string;
  interactionLog?: string;
  finalVideo?: string;
  subtitleFile?: string;
  error?: string;
  createdAt: number;
  completedAt?: number;
}

/** Step execution result from agent-browser */
export interface StepResult {
  stepId: string;
  success: boolean;
  error?: string;
  /** DOM snapshot taken after action */
  snapshotPath?: string;
  /** Timestamp in the raw recording (seconds) */
  timestamp: number;
  /** Cursor position at time of action */
  cursorPosition?: { x: number; y: number };
}

/** Browser interaction event logged during recording */
export interface InteractionEvent {
  type: "mousemove" | "click" | "scroll" | "type" | "navigation" | "hover";
  timestamp: number; // ms from start
  data: {
    x?: number; y?: number;
    selector?: string;
    text?: string;
    scrollX?: number; scrollY?: number;
    /** For click events — is this a press or release */
    clickState?: "down" | "up";
  };
  snapshotBefore?: string;
  snapshotAfter?: string;
}

/** Assembly output paths */
export interface AssemblyOutput {
  finalVideo: string;
  subtitleFile: string;
  narrationAudio: string;
}
