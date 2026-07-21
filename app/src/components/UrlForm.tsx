import { useState, type FormEvent, type ReactNode } from "react";

interface UrlFormProps {
  onSubmit: (url: string, scenario: string) => Promise<void>;
  initialUrl?: string;
  initialScenario?: string;
}

export default function UrlForm({ onSubmit, initialUrl = "", initialScenario = "" }: UrlFormProps) {
  const [url, setUrl] = useState(initialUrl);
  const [scenario, setScenario] = useState(initialScenario);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);

    // Trim + validate
    const cleanUrl = url.trim();
    const cleanScenario = scenario.trim();

    if (!cleanUrl) {
      setError("URL is required");
      return;
    }

    try {
      new URL(cleanUrl);
    } catch {
      setError("Invalid URL — enter a full URL starting with https://");
      return;
    }

    if (cleanScenario.length < 10) {
      setError("Describe the walkthrough in at least a few words");
      return;
    }

    setLoading(true);
    try {
      await onSubmit(cleanUrl, cleanScenario);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="mx-auto max-w-2xl space-y-5">
      {/* URL field */}
      <div>
        <label htmlFor="url" className="block text-sm font-medium mb-1.5">
          Website URL
        </label>
        <input
          id="url"
          type="url"
          placeholder="https://bankin-report.cashlessconsumer.in"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          disabled={loading}
          className="block w-full rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-4 py-2.5 text-sm placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:opacity-50 font-mono"
        />
        <p className="mt-1 text-xs text-zinc-400">
          The page where the walkthrough starts
        </p>
      </div>

      {/* Scenario field */}
      <div>
        <label htmlFor="scenario" className="block text-sm font-medium mb-1.5">
          What to show
        </label>
        <textarea
          id="scenario"
          rows={4}
          placeholder="Navigate through the cookie tracking dashboard, show the domain filter working, then inspect the tracking cookie details for a sample bank..."
          value={scenario}
          onChange={(e) => setScenario(e.target.value)}
          disabled={loading}
          className="block w-full rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-4 py-2.5 text-sm placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:opacity-50 resize-y"
        />
        <p className="mt-1 text-xs text-zinc-400">
          Describe the flow in natural language — what to click, where to go, what to highlight
        </p>
      </div>

      {/* Error */}
      {error && (
        <div className="rounded-lg border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/20 px-4 py-3 text-sm text-red-700 dark:text-red-400">
          {error}
        </div>
      )}

      {/* Submit */}
      <button
        type="submit"
        disabled={loading}
        className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-5 py-2.5 text-sm font-medium text-white hover:bg-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
      >
        {loading ? (
          <>
            <LoadingDots />
            Generating plan…
          </>
        ) : (
          "Generate Plan"
        )}
      </button>
    </form>
  );
}

/** Inline animated dots — no external dependency */
function LoadingDots() {
  return (
    <span className="inline-flex items-center gap-0.5">
      <span className="size-1.5 animate-bounce rounded-full bg-white [animation-delay:0ms]" />
      <span className="size-1.5 animate-bounce rounded-full bg-white [animation-delay:150ms]" />
      <span className="size-1.5 animate-bounce rounded-full bg-white [animation-delay:300ms]" />
    </span>
  );
}
