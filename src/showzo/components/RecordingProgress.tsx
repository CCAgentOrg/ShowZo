import { useState, useEffect } from "react";
import type { RecordingState } from "../types";
import type { StepRecordStatus } from "../types";

interface Props {
  /** Controlled recording state — polled or pushed from the server */
  state: RecordingState;
  /** Called when user wants to cancel the recording */
  onCancel?: () => void;
  /** Called after recording completes */
  onComplete?: () => void;
}

const STATUS_ORDER: StepRecordStatus[] = ["pending", "running", "done", "error"];

function statusIndex(s: StepRecordStatus): number {
  return STATUS_ORDER.indexOf(s);
}

export default function RecordingProgress({ state, onCancel, onComplete }: Props) {
  const isActive = state.status === "recording" || state.status === "assembling";
  const isFailed = state.status === "failed";

  // Notify parent on terminal states
  useEffect(() => {
    if (state.status === "complete") {
      onComplete?.();
    }
  }, [state.status, onComplete]);

  // Elapsed time display (increment local clock when active)
  const [localElapsed, setLocalElapsed] = useState(state.elapsedMs);
  useEffect(() => {
    if (!isActive) {
      setLocalElapsed(state.elapsedMs);
      return;
    }
    setLocalElapsed(state.elapsedMs);
    const interval = setInterval(() => {
      setLocalElapsed((prev) => prev + 1000);
    }, 1000);
    return () => clearInterval(interval);
  }, [isActive, state.elapsedMs]);

  function formatTime(ms: number): string {
    const totalSeconds = Math.floor(ms / 1000);
    const m = Math.floor(totalSeconds / 60);
    const s = totalSeconds % 60;
    return `${m}:${s.toString().padStart(2, "0")}`;
  }

  // Terminal states don't show step indicators
  if (state.status === "complete") {
    return (
      <div className="mx-auto max-w-2xl text-center">
        <div className="inline-flex size-16 items-center justify-center rounded-full bg-emerald-100 dark:bg-emerald-900/30">
          <svg className="size-8 text-emerald-600 dark:text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
        </div>
        <h3 className="mt-4 text-lg font-semibold">Recording Complete</h3>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
          {formatTime(localElapsed)} total
        </p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      {/* Status banner */}
      <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 px-5 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            {isActive ? (
              <span className="relative flex size-5">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-indigo-400 opacity-75" />
                <span className="relative inline-flex size-5 rounded-full bg-indigo-500" />
              </span>
            ) : isFailed ? (
              <span className="inline-flex size-5 items-center justify-center rounded-full bg-red-500 text-white text-xs font-bold">
                !
              </span>
            ) : null}
            <div>
              <p className="text-sm font-medium">
                {state.status === "recording" && `Recording step ${state.currentStep + 1} of ${state.totalSteps}`}
                {state.status === "assembling" && "Assembling final video..."}
                {state.status === "failed" && "Recording failed"}
              </p>
              <p className="text-xs text-zinc-400">{formatTime(localElapsed)} elapsed</p>
            </div>
          </div>

          {isActive && onCancel && (
            <button
              onClick={onCancel}
              className="rounded-lg border border-zinc-300 dark:border-zinc-600 px-3 py-1.5 text-xs font-medium hover:bg-red-50 dark:hover:bg-red-900/20 hover:text-red-600 transition-colors"
            >
              Cancel
            </button>
          )}
        </div>
      </div>

      {/* Step list */}
      <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 divide-y divide-zinc-200 dark:divide-zinc-800">
        {state.steps.map((step) => (
          <div
            key={step.id}
            className={`flex items-center gap-3 px-5 py-3 text-sm transition-colors ${
              statusIndex(step.status) >= statusIndex("running")
                ? "bg-zinc-50 dark:bg-zinc-900/50"
                : "opacity-40"
            }`}
          >
            {/* Status icon */}
            <span className="flex size-5 shrink-0 items-center justify-center">
              {step.status === "pending" && (
                <span className="size-2 rounded-full bg-zinc-300 dark:bg-zinc-600" />
              )}
              {step.status === "running" && (
                <span className="size-2.5 animate-spin rounded-full border-2 border-indigo-500 border-t-transparent" />
              )}
              {step.status === "done" && (
                <svg className="size-4 text-emerald-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                </svg>
              )}
              {step.status === "error" && (
                <svg className="size-4 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
                </svg>
              )}
            </span>

            {/* Step info */}
            <div className="min-w-0 flex-1">
              <p className="font-medium text-zinc-800 dark:text-zinc-200">
                {step.order}. {step.action}
              </p>
              {step.narration && (
                <p className="mt-0.5 text-xs text-zinc-400 italic truncate">
                  {step.narration}
                </p>
              )}
            </div>

            {/* Duration */}
            {step.duration && (
              <span className="shrink-0 text-xs text-zinc-400 font-mono">
                {step.duration}s
              </span>
            )}
          </div>
        ))}
      </div>

      {/* Error banner */}
      {isFailed && state.error && (
        <div className="rounded-lg border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/20 px-4 py-3 text-sm text-red-700 dark:text-red-400">
          {state.error}
        </div>
      )}

      {/* Log output (debug) */}
      {state.log && state.log.length > 0 && (
        <details className="rounded-lg border border-zinc-200 dark:border-zinc-800">
          <summary className="cursor-pointer px-4 py-2 text-xs font-medium text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300 select-none">
            Recording log ({state.log.length} entries)
          </summary>
          <div className="max-h-48 overflow-y-auto border-t border-zinc-200 dark:border-zinc-800 p-4">
            <pre className="text-xs text-zinc-400 font-mono leading-relaxed">
              {state.log.join("\n")}
            </pre>
          </div>
        </details>
      )}
    </div>
  );
}
