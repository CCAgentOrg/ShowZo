/**
 * plan.ts — LLM plan generator
 *
 * Takes a URL + natural language scenario description and produces
 * a structured ActionPlan. Uses the Zo /ask API to get the LLM's
 * analysis, then parses the structured response.
 */

import type { ActionPlan, Step } from "./types";

const MODEL = process.env.ZO_MODEL || "byok:b5700bd6-fca9-4aa2-9d31-bc9f5bb33bbc";

const PLAN_SYSTEM_PROMPT = `You are a product walkthrough planner. Given a URL and a scenario description, produce a step-by-step action plan for recording a screen walkthrough video.

Each step must be one of: navigate, click, type, scroll, wait, assert, hover, screenshot.

For each step, provide:
- The exact action to execute
- A CSS selector or description of the element to interact with
- The value (for type/scroll/navigate actions)
- A clear narration line (what the voiceover says during this step)
- An estimated pause in ms after the action

Output ONLY valid JSON matching this schema:
{
  "title": "Walkthrough title",
  "viewport": { "width": 1280, "height": 720 },
  "totalDurationEstimate": 90,
  "steps": [
    {
      "id": "step-1",
      "order": 1,
      "action": "navigate",
      "value": "https://...",
      "narration": "Let's start by navigating to...",
      "pauseMs": 2000
    },
    {
      "id": "step-2",
      "order": 2,
      "action": "click",
      "target": "button:has-text('Sign In')",
      "narration": "Click the sign in button...",
      "pauseMs": 1500
    }
  ]
}`;

interface PlanInput {
  url: string;
  scenario: string;
}

/**
 * Generate an action plan from URL + scenario via Zo/ask API.
 */
export async function generatePlan(input: PlanInput): Promise<ActionPlan> {
  const userPrompt = `URL: ${input.url}\nScenario: ${input.scenario}\n\nGenerate a walkthrough plan for recording a demo video.`;

  const response = await fetch("https://api.zo.computer/zo/ask", {
    method: "POST",
    headers: {
      authorization: process.env.ZO_CLIENT_IDENTITY_TOKEN || "",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      input: `${PLAN_SYSTEM_PROMPT}\n\n${userPrompt}`,
      model_name: MODEL,
      output_format: {
        type: "object",
        properties: {
          title: { type: "string" },
          viewport: {
            type: "object",
            properties: {
              width: { type: "number" },
              height: { type: "number" },
            },
            required: ["width", "height"],
          },
          totalDurationEstimate: { type: "number" },
          steps: {
            type: "array",
            items: {
              type: "object",
              properties: {
                id: { type: "string" },
                order: { type: "number" },
                action: { type: "string", enum: ["navigate", "click", "type", "scroll", "wait", "assert", "hover", "screenshot"] },
                target: { type: "string" },
                value: { type: "string" },
                narration: { type: "string" },
                pauseMs: { type: "number" },
              },
              required: ["id", "order", "action", "narration"],
            },
          },
        },
        required: ["title", "viewport", "totalDurationEstimate", "steps"],
      },
    }),
  });

  if (!response.ok) {
    throw new Error(`Plan generation failed: ${response.status} ${await response.text()}`);
  }

  const result = await response.json();
  const plan = result.output as ActionPlan;

  return {
    ...plan,
    url: input.url,
    scenario: input.scenario,
  };
}

// CLI usage
if (import.meta.main) {
  const url = process.argv[2];
  const scenario = process.argv.slice(3).join(" ");
  if (!url || !scenario) {
    console.error("Usage: bun run plan.ts <url> <scenario description>");
    process.exit(1);
  }
  const plan = await generatePlan({ url, scenario });
  console.log(JSON.stringify(plan, null, 2));
}
