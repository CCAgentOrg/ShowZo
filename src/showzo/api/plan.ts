/**
 * plan.ts — LLM plan generator via Zo /ask API
 *
 * Takes a URL + natural language scenario, uses Zo's AI to
 * generate a structured walkthrough plan with action steps.
 */

import type { ActionPlan, Step } from "../pipeline/types";

const ZO_ASK_API = "https://api.zo.computer/zo/ask";

/**
 * Generate a walkthrough plan using the Zo /ask API.
 * Falls back to a reasonable mock plan if the API is unavailable.
 */
export async function generatePlan(url: string, scenario: string): Promise<ActionPlan> {
  const token = process.env.ZO_CLIENT_IDENTITY_TOKEN;
  const modelName = process.env.ZO_MODEL || "byok:b5700bd6-fca9-4aa2-9d31-bc9f5bb33bbc";

  if (!token) {
    console.warn("plan: ZO_CLIENT_IDENTITY_TOKEN not set — using fallback plan");
    return fallbackPlan(url, scenario);
  }

  try {
    const response = await fetch(ZO_ASK_API, {
      method: "POST",
      headers: {
        authorization: token,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        input: buildPrompt(url, scenario),
        model_name: modelName,
      }),
      signal: AbortSignal.timeout(60_000),
    });

    if (!response.ok) {
      console.warn(`plan: Zo API returned ${response.status} — using fallback`);
      return fallbackPlan(url, scenario);
    }

    const data = await response.json();
    const text = data.output || "";

    // Try to extract a JSON block from the response
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      try {
        const parsed = JSON.parse(jsonMatch[0]);
        return normalizePlan(parsed, url);
      } catch {
        console.warn("plan: Failed to parse LLM JSON — using fallback");
      }
    }

    console.warn("plan: No JSON in LLM response — using fallback");
    return fallbackPlan(url, scenario);
  } catch (err) {
    console.warn("plan: API error:", (err as Error).message, "— using fallback");
    return fallbackPlan(url, scenario);
  }
}

/**
 * Build a structured prompt for the Zo LLM.
 */
function buildPrompt(url: string, scenario: string): string {
  return `You are a walkthrough video planner. Given a URL and a natural language scenario, produce a JSON walkthrough plan.

URL: ${url}
Scenario: ${scenario}

Rules:
- The first step must be {"action":"navigate","target":"${url}"} with no narration.
- Each subsequent step is one action: click, type, scroll, wait, hover, or screenshot.
- For "click", provide the CSS selector or text of the element in "target".
- For "type", provide "target" (the input selector) and "value" (the text to type).
- For "scroll", provide "value" (pixels, positive = down).
- For "wait", provide "value" (milliseconds).
- Keep the total steps under 10.
- Each step should have a "narration" field explaining what's happening (1 sentence).
- The last step should be "screenshot" to capture the final state.

Respond ONLY with a JSON object matching this TypeScript interface:
{
  "title": string,
  "url": string,
  "steps": Array<{
    "id": string,
    "order": number,
    "action": "navigate" | "click" | "type" | "scroll" | "wait" | "hover" | "screenshot",
    "target"?: string,
    "value"?: string | number,
    "narration"?: string,
    "pauseMs"?: number
  }>,
  "metadata": {
    "estimatedDuration": number
  }
}`;
}

/**
 * Normalize a parsed LLM response into a valid ActionPlan.
 */
function normalizePlan(raw: any, url: string): ActionPlan {
  const steps: Step[] = (raw.steps || []).map((s: any, i: number) => ({
    id: s.id || String(i + 1),
    order: s.order || i + 1,
    action: safeAction(s.action),
    target: s.target || undefined,
    value: s.value !== undefined ? s.value : undefined,
    narration: s.narration || undefined,
    pauseMs: s.pauseMs || (i === 0 ? 2000 : 800),
  }));

  return {
    title: raw.title || `Walkthrough of ${url}`,
    url: url,
    steps,
    metadata: {
      estimatedDuration: raw.metadata?.estimatedDuration || steps.length * 8,
    },
  };
}

function safeAction(a: string): Step["action"] {
  const valid: Step["action"][] = [
    "navigate", "click", "type", "scroll", "wait", "hover", "screenshot", "highlight",
  ];
  return valid.includes(a as Step["action"]) ? (a as Step["action"]) : "wait";
}

/**
 * Generate a reasonable fallback plan when the LLM API is unavailable.
 */
function fallbackPlan(url: string, scenario: string): ActionPlan {
  const steps: Step[] = [
    { id: "1", order: 1, action: "navigate", target: url, pauseMs: 2000 },
  ];

  // Parse the scenario to guess the action
  const s = scenario.toLowerCase();
  if (s.includes("search") || s.includes("find")) {
    steps.push(
      { id: "2", order: 2, action: "click", target: "input[type=search], input[placeholder*=search], [aria-label*=search]", narration: "Focus the search box", pauseMs: 500 },
      { id: "3", order: 3, action: "wait", value: 500, pauseMs: 200 },
    );
  }

  const hasScrollAction = s.includes("scroll") || s.includes("browse") || s.includes("explore") || s.includes("read");
  if (hasScrollAction) {
    steps.push(
      { id: String(steps.length + 1), order: steps.length + 1, action: "scroll", value: 600, narration: "Scroll down to view content", pauseMs: 1000 },
      { id: String(steps.length + 2), order: steps.length + 2, action: "scroll", value: 600, narration: "Scroll further", pauseMs: 1000 },
    );
  }

  const hasClick = s.includes("click") || s.includes("open") || s.includes("navigate") || s.includes("button");
  if (hasClick) {
    steps.push(
      { id: String(steps.length + 1), order: steps.length + 1, action: "click", target: "a, button, [role=button]", narration: "Click the first link or button", pauseMs: 1000 },
    );
  }

  // Add highlight step at end
  steps.push({
    id: String(steps.length + 1),
    order: steps.length + 1,
    action: "screenshot",
    narration: "Capture the final state",
    pauseMs: 200,
  });

  return {
    title: `Walkthrough of ${url}`,
    url,
    steps,
    metadata: { estimatedDuration: steps.length * 10 },
  };
}
