/**
 * plan.mjs — Plan generation using Zo /ask API
 * This file is imported by server.ts for the /api/plan endpoint.
 * It uses Zo's /ask API to convert a URL + scenario into a structured action plan.
 */

const ZO_ASK_URL = "https://api.zo.computer/zo/ask";
const MODEL = "byok:b5700bd6-fca9-4aa2-9d31-bc9f5bb33bbc";

/**
 * Generate a walkthrough plan from a URL and scenario description.
 * @param {string} url - The target URL to walk through
 * @param {string} scenario - Natural language scenario description
 * @returns {Promise<{title: string, url: string, steps: Array, metadata?: Object}>}
 */
export async function generatePlan(url, scenario) {
  const authToken = process.env.ZO_CLIENT_IDENTITY_TOKEN;
  if (!authToken) {
    throw new Error("ZO_CLIENT_IDENTITY_TOKEN not set — cannot call Zo /ask API");
  }

  const prompt = `You are ShowZo, an agentic walkthrough video planner.

Given a URL and a user scenario, produce a structured action plan that an automated browser agent will execute.

URL: ${url}
Scenario: ${scenario}

Rules for the plan:
1. Start with a "navigate" action to open the URL.
2. Each step must be one of: navigate, click, type, scroll, wait, screenshot, hover, press
3. Include CSS selectors as targets where possible (e.g., "button:has-text('Sign In')", "#search-input", "a[href='/pricing']")
4. For "type" actions, include the text value to type.
5. For "scroll" actions, specify the pixel amount.
6. For "wait" actions, specify milliseconds.
7. Each step MUST have a narration string (1-2 sentences explaining what's happening).
8. Keep steps sequential and logical.
9. Limit to 12 steps maximum.
10. The final step should always be a screenshot or wait to capture the result.

Output ONLY valid JSON with this exact structure:
{
  "title": "Short descriptive title (max 60 chars)",
  "url": "${url}",
  "steps": [
    {
      "id": "1",
      "order": 1,
      "action": "navigate",
      "target": "${url}",
      "narration": "Navigate to the page"
    }
  ],
  "metadata": {
    "estimatedDuration": 30
  }
}`;

  const response = await fetch(ZO_ASK_URL, {
    method: "POST",
    headers: {
      "authorization": authToken,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      input: prompt,
      model_name: MODEL,
      output_format: {
        type: "object",
        properties: {
          title: { type: "string" },
          url: { type: "string" },
          steps: {
            type: "array",
            items: {
              type: "object",
              properties: {
                id: { type: "string" },
                order: { type: "number" },
                action: { type: "string" },
                target: { type: "string" },
                value: { type: "string" },
                narration: { type: "string" },
              },
              required: ["id", "order", "action", "narration"],
            },
          },
          metadata: {
            type: "object",
            properties: {
              estimatedDuration: { type: "number" },
            },
          },
        },
        required: ["title", "url", "steps"],
      },
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Zo /ask API error (${response.status}): ${text}`);
  }

  const result = await response.json();
  const plan = result.output;

  // Validate structure
  if (!plan || !plan.title || !Array.isArray(plan.steps) || plan.steps.length === 0) {
    throw new Error("Zo returned an invalid plan structure");
  }

  // Ensure first step is navigate
  if (plan.steps[0].action !== "navigate") {
    plan.steps.unshift({
      id: "0",
      order: 0,
      action: "navigate",
      target: url,
      narration: `Navigate to ${url}`,
    });
    plan.steps.forEach((s, i) => {
      s.id = String(i + 1);
      s.order = i + 1;
    });
  }

  return plan;
}
