import { useState, useEffect, useRef } from "react";
import UrlForm from "./components/UrlForm";
import RecordingProgress from "./components/RecordingProgress";
import type { PlanResponse, RecordingState } from "./types";
import { fetchPlan } from "./api/client";

export default function App() {
  const [plan, setPlan] = useState<PlanResponse | null>(null);
  const [recording, setRecording] = useState<RecordingState | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  async function handleSubmit(url: string, scenario: string) {
    const data = await fetchPlan({ url, scenario });
    setPlan(data);
  }

  async function startRecording() {
    if (!plan) return;

    setRecording({
      sessionId: "",
      status: "recording",
      currentStep: 0,
      totalSteps: plan.steps.length,
      steps: plan.steps.map((s, i) => ({
        id: s.id,
        order: i + 1,
        action: s.action,
        narration: s.narration,
        status: "pending" as const,
      })),
      elapsedMs: 0,
      log: [],
    });

    try {
      const resp = await fetch("/api/record", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plan }),
      });
      if (!resp.ok) throw new Error(`Record start failed: ${resp.status}`);
      const { sessionId } = await resp.json();

      // Poll session status
      pollRef.current = setInterval(async () => {
        const res = await fetch(`/api/session/${sessionId}`);
        if (!res.ok) {
          clearInterval(pollRef.current!);
          return;
        }
        const state: RecordingState = await res.json();
        state.totalSteps = plan.steps.length; // keep in sync
        setRecording(state);
        if (state.status === "complete" || state.status === "failed") {
          clearInterval(pollRef.current!);
        }
      }, 2000);
    } catch (err) {
      setRecording((prev) =>
        prev
          ? { ...prev, status: "failed", error: err instanceof Error ? err.message : "Unknown error" }
          : prev
      );
    }
  }

  function cancelRecording() {
    if (pollRef.current) clearInterval(pollRef.current);
    setRecording(null);
  }

  useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950 text-zinc-900 dark:text-zinc-100">
      {/* Header */}
      <header className="border-b border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900">
        <div className="mx-auto flex max-w-5xl items-center gap-3 px-6 py-4">
          <span className="flex size-9 items-center justify-center rounded-lg bg-indigo-600 text-sm font-bold text-white">
            SZ
          </span>
          <div>
            <h1 className="text-lg font-semibold">ShowZo</h1>
            <p className="text-xs text-zinc-500 dark:text-zinc-400">
              Agentic walkthrough video generator
            </p>
          </div>
        </div>
      </header>

      {/* Body */}
      <main className="mx-auto max-w-5xl px-6 py-12">
        {recording ? (
          <RecordingProgress state={recording} onCancel={cancelRecording} />
        ) : plan ? (
          <div className="space-y-6">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-xl font-semibold">Plan Generated</h2>
                <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
                  <span className="font-mono text-xs">{plan.url}</span>
                  {plan.metadata?.estimatedDuration && (
                    <span className="ml-3">
                      ~{plan.metadata.estimatedDuration}s estimated
                    </span>
                  )}
                </p>
              </div>
              <button
                onClick={() => setPlan(null)}
                className="rounded-lg border border-zinc-300 dark:border-zinc-600 px-3 py-1.5 text-xs font-medium hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
              >
                Start Over
              </button>
            </div>

            <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 divide-y divide-zinc-200 dark:divide-zinc-800">
              {plan.steps.map((step, i) => (
                <div
                  key={step.id}
                  className="flex items-start gap-4 px-5 py-3.5 text-sm"
                >
                  <span className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full bg-indigo-100 dark:bg-indigo-900/40 text-xs font-medium text-indigo-700 dark:text-indigo-300">
                    {i + 1}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="font-medium text-zinc-800 dark:text-zinc-200">
                      {step.action}
                      {step.target && (
                        <code className="ml-2 rounded bg-zinc-100 dark:bg-zinc-800 px-1.5 py-0.5 text-xs font-mono text-zinc-600 dark:text-zinc-400">
                          {step.target}
                        </code>
                      )}
                    </div>
                    {step.value && (
                      <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">
                        value:{" "}
                        <code className="font-mono">{String(step.value)}</code>
                      </p>
                    )}
                    {step.narration && (
                      <p className="mt-0.5 text-xs text-zinc-400 italic leading-relaxed">
                        {step.narration}
                      </p>
                    )}
                  </div>
                </div>
              ))}
            </div>

            <div className="flex justify-center pt-2">
              <button
                onClick={startRecording}
                className="inline-flex items-center gap-2 rounded-lg bg-green-600 px-6 py-3 text-sm font-medium text-white hover:bg-green-500 transition-colors"
              >
                <span className="size-2 rounded-full bg-white animate-pulse" />
                Start Recording ({plan.steps.length} steps)
              </button>
            </div>
          </div>
        ) : (
          <>
            <div className="mb-10 text-center">
              <h2 className="text-2xl font-bold">
                Generate a walkthrough video
              </h2>
              <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400 max-w-md mx-auto">
                Paste a URL, describe what to show. ShowZo drives the browser,
                records, and assembles a narrated video.
              </p>
            </div>
            <UrlForm onSubmit={handleSubmit} />
          </>
        )}
      </main>
    </div>
  );
}
