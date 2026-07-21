import { useState } from "react";
import UrlForm from "./components/UrlForm";
import type { PlanResponse } from "./types";

export default function App() {
  const [plan, setPlan] = useState<PlanResponse | null>(null);

  async function handleSubmit(url: string, scenario: string) {
    const resp = await fetch("/api/plan", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url, scenario }),
    });

    if (!resp.ok) {
      const body = await resp.json().catch(() => null);
      throw new Error(body?.error || `Server error: ${resp.status}`);
    }

    const data = (await resp.json()) as PlanResponse;
    setPlan(data);
  }

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
        {plan ? (
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
