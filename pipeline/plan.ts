#!/usr/bin/env bun
/**
 * plan.ts — Page analysis + AI script generation
 *
 * Phase 1: analyze the page with agent-browser
 * Phase 2: use Zo's AI to generate a structured action plan + narrated scenes
 *
 * Export: generatePlan(url, intent?, outputPath?) → ActionPlan
 * CLI:    bun plan.ts <url> [--intent] [--output]
 */

import { parseArgs } from "util";
import { writeFile, mkdir } from "fs/promises";
import { join } from "path";
import { execSync } from "child_process";
import type { ActionPlan, Step, Scene } from "./types";

// ── Exported API ───────────────────────────────────────────────────────────
export type { ActionPlan, Step, Scene };

export async function generatePlan(
  url: string,
  intent = "Show a walkthrough of this page",
  outputPath = "plan.json",
): Promise<ActionPlan> {
  return await runPlan(url, intent, outputPath);
}

// ── CLI entry ───────────────────────────────────────────────────────────────
const args = parseArgs({
  args: Bun.argv.slice(2),
  options: {
    intent: { type: "string", short: "i", default: "Show a walkthrough of this page" },
    output: { type: "string", short: "o", default: "plan.json" },
    model: { type: "string", short: "m", default: "byok:b5700bd6-fca9-4aa2-9d31-bc9f5bb33bbc" },
  },
  allowPositionals: true,
});
const [url] = args.positionals;
if (url && import.meta.path === Bun.main) {
  runPlan(url, args.values.intent!, args.values.output!).catch(e => {
    console.error(`\n❌ ${e.message}`);
    process.exit(1);
  });
}

// ── Core logic ──────────────────────────────────────────────────────────────
async function runPlan(url: string, intent: string, outputPath: string): Promise<ActionPlan> {
  const modelName = args.values?.model || "byok:b5700bd6-fca9-4aa2-9d31-bc9f5bb33bbc";
  const WORKDIR = join(process.cwd(), `.plan-${Date.now()}`);
  await mkdir(WORKDIR, { recursive: true });

  // ── Phase 1: Page Analysis ────────────────────────────────────────────────
  console.log(`🔍 Analyzing page: ${url}`);
  execSync(`agent-browser open "${url}" 2>/dev/null`, { timeout: 30_000 });
  execSync(`sleep 2`);

  execSync(`agent-browser screenshot ${WORKDIR}/fullpage.png --full-page 2>/dev/null`, { timeout: 15_000 });

  const snapshotResult = execSync(`agent-browser snapshot -i 2>/dev/null`, { encoding: "utf-8", timeout: 15_000 });
  await writeFile(`${WORKDIR}/snapshot.txt`, snapshotResult);

  const pageText = execSync(`agent-browser eval 'document.body.innerText.slice(0, 8000)' 2>/dev/null`, {
    encoding: "utf-8", timeout: 10_000,
  }).trim();

  const interactiveElements = execSync(
    `agent-browser eval 'JSON.stringify([...document.querySelectorAll("a, button, input, select, textarea, [role=button], [role=link], [role=tab], [tabindex]")].slice(0, 50).map(el => ({ tag: el.tagName, text: el.innerText?.slice(0, 60) || el.placeholder, type: el.type, href: el instanceof HTMLAnchorElement ? el.href.slice(0, 120) : null, role: el.getAttribute("role"), selector: el.id ? "#" + el.id : el.className?.slice(0, 50) || el.tagName })))' 2>/dev/null`,
    { encoding: "utf-8", timeout: 10_000 }
  ).trim();

  const pageUrl = execSync(`agent-browser eval 'window.location.href' 2>/dev/null`, { encoding: "utf-8", timeout: 5_000 }).trim();
  const pageTitle = execSync(`agent-browser eval 'document.title' 2>/dev/null`, { encoding: "utf-8", timeout: 5_000 }).trim();

  console.log(`📄 Title: ${pageTitle}`);
  console.log(`🧩 Interactive elements: ${interactiveElements.length > 20 ? "found" : "none detected"}`);

  // ── Phase 2: AI Script Generation ─────────────────────────────────────────
  console.log("🤖 Generating script via Zo AI...");

  const llmPrompt = `You are a product demo scriptwriter. Given a web page's content and interactive elements, generate a structured walkthrough plan.

URL: ${pageUrl}
Page Title: ${pageTitle}
User Intent: ${intent}

Page Content (first 8000 chars):
${pageText.slice(0, 6000)}

Interactive Elements Found:
${interactiveElements.slice(0, 3000)}

OUTPUT FORMAT (return ONLY valid JSON, no markdown):
{
  "steps": [
    {
      "id": "step-1",
      "order": 1,
      "action": "navigate",
      "narration": "Welcome to...",
      "expected": "Page loads"
    },
    {
      "id": "step-2",
      "order": 2,
      "action": "click",
      "target": "h2",
      "narration": "Let's click on...",
      "expected": "Section opens"
    }
  ],
  "scenes": [
    {
      "order": 1,
      "title": "Introduction",
      "narration": "Full narration paragraph for this scene...",
      "duration": 15,
      "zoomTarget": { "x": 0.5, "y": 0.3, "scale": 1.0 },
      "stepRange": [1, 2]
    }
  ],
  "metadata": {
    "pageDescription": "Brief summary",
    "keyElements": ["login form", "navigation", "dashboard"],
    "estimatedDuration": 90
  }
}

Rules:
- Steps map to actual browser actions. 3-8 steps max.
- Scenes are narrated segments with full paragraph narration.
- Scene duration in seconds. Total 45-180 seconds.
- zoomTarget.x and .y are 0-1 (viewport fraction). Scale 1.0 = no zoom, 2.0 = 2x.
- Narration should be conversational, tutorial-style.
- Match the user's intent: "${intent}"`;

  const response = await fetch("https://api.zo.computer/zo/ask", {
    method: "POST",
    headers: {
      "authorization": process.env.ZO_CLIENT_IDENTITY_TOKEN || "",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      input: llmPrompt,
      model_name: modelName,
    }),
  });

  if (!response.ok) throw new Error(`Zo Ask API failed: ${response.status} ${await response.text()}`);
  const result = (await response.json()) as { output?: string };
  const rawOutput = result.output || "";
  const jsonMatch = rawOutput.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error("No JSON found in LLM response:\n" + rawOutput.slice(0, 500));

  const plan: ActionPlan = JSON.parse(jsonMatch[0]);
  plan.title = plan.title || pageTitle;
  plan.url = pageUrl;

  // ── Write output ──────────────────────────────────────────────────────────
  await writeFile(outputPath, JSON.stringify(plan, null, 2));

  console.log(`\n✅ Plan generated: ${outputPath}`);
  console.log(`   Scenes: ${plan.scenes?.length || 0}`);
  console.log(`   Steps: ${plan.steps?.length || 0}`);
  console.log(`   Est. duration: ${plan.metadata?.estimatedDuration || "?"}s`);

  try { execSync(`rm -rf ${WORKDIR}`, { timeout: 5_000 }); } catch {}
  return plan;
}
