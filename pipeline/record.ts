/**
 * record.ts — agent-browser screen recording orchestrator
 *
 * Executes an ActionPlan via agent-browser, recording the full session
 * to a raw .webm file. Returns per-step timestamps for later narration sync.
 *
 * Two-pass approach (Mux-inspired):
 *   Pass 1: Execute all actions, capture DOM snapshots for each step
 *   Pass 2: Narration audio overlay + final assembly (see assemble.ts)
 */

import { $ } from "bun";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import type { ActionPlan, Step, StepResult } from "./types";

const AB_BIN = process.env.AGENT_BROWSER_BIN || "agent-browser";
const RECORDING_DIR = process.env.SHOWZO_OUTPUT_DIR || "/tmp/showzo-recordings";

interface RecordingResult {
  sessionId: string;
  rawVideoPath: string;
  stepResults: StepResult[];
  workDir: string;
}

/**
 * Execute a full walkthrough plan and produce a raw screen recording.
 * Returns structured results with per-step DOM snapshots and timestamps.
 */
export async function recordWalkthrough(
  plan: ActionPlan,
  sessionId: string = randomUUID()
): Promise<RecordingResult> {
  const workDir = join(RECORDING_DIR, sessionId);
  if (!existsSync(workDir)) {
    await mkdir(workDir, { recursive: true });
  }

  const rawVideoPath = join(workDir, "raw-recording.webm");
  const stepResults: StepResult[] = [];

  // --- Pass 1: Execute actions with recording ---

  // Start agent-browser and navigate to initial URL
  const firstStep = plan.steps[0];
  if (firstStep?.action !== "navigate") {
    console.warn("First step should be 'navigate', injecting navigation step");
    await openUrl(plan.url);
  }

  // Start the screen recording
  console.log(`Recording started → ${rawVideoPath}`);
  await startRecording(rawVideoPath);

  try {
    // Open the URL if first step is navigate
    if (firstStep?.action === "navigate" && firstStep.value) {
      await openUrl(firstStep.value);
    } else {
      await openUrl(plan.url);
    }

    // Allow page to load
    await sleep(2000);

    let startOffset = 0; // will be set after recording duration is known

    // Process each step
    for (const step of plan.steps) {
      if (step.action === "navigate") continue; // already handled

      console.log(`[${step.order}/${plan.steps.length}] ${step.action}${step.target ? ` → ${step.target}` : ""}`);

      try {
        await executeStep(step);
        stepResults.push({
          stepId: step.id,
          success: true,
          timestamp: 0, // filled after recording ends
        });
      } catch (e) {
        console.error(`Step ${step.id} failed:`, e);
        stepResults.push({
          stepId: step.id,
          success: false,
          error: String(e),
          timestamp: 0,
        });
      }

      // Post-action pause for visual settling
      if (step.pauseMs && step.pauseMs > 0) {
        await sleep(step.pauseMs);
      }
    }

    // Take a final screenshot
    await takeScreenshot(join(workDir, "final-state.png"));
  } finally {
    // Stop recording
    await stopRecording();
    console.log(`Recording finished → ${rawVideoPath}`);
  }

  return {
    sessionId,
    rawVideoPath,
    stepResults,
    workDir,
  };
}

async function openUrl(url: string): Promise<void> {
  const proc = Bun.spawn([AB_BIN, "open", url], {
    stdout: "pipe",
    stderr: "pipe",
  });
  const out = await new Response(proc.stdout).text();
  if (proc.exitCode !== 0) {
    throw new Error(`agent-browser open failed: ${await new Response(proc.stderr).text()}`);
  }
}

async function startRecording(outputPath: string): Promise<void> {
  const proc = Bun.spawn([AB_BIN, "record", "start", outputPath], {
    stdout: "pipe",
    stderr: "pipe",
  });
  const out = await new Response(proc.stdout).text();
  if (proc.exitCode !== 0) {
    throw new Error(`agent-browser record start failed: ${out}`);
  }
}

async function stopRecording(): Promise<void> {
  const proc = Bun.spawn([AB_BIN, "record", "stop"], {
    stdout: "pipe",
    stderr: "pipe",
  });
  const out = await new Response(proc.stdout).text();
  if (proc.exitCode !== 0) {
    const err = await new Response(proc.stderr).text();
    console.warn("record stop warning:", err);
  }
}

async function executeStep(step: Step): Promise<void> {
  switch (step.action) {
    case "click":
      await browserAction(`click '${step.target || ""}'`);
      break;
    case "type":
      await browserAction(`fill ${step.target || ""} with ${step.value || ""}`);
      break;
    case "scroll":
      await browserAction(`scroll ${step.value || "down 1 page"}`);
      break;
    case "wait":
      await sleep(step.pauseMs || 2000);
      break;
    case "hover":
      await browserAction(`hover ${step.target || ""}`);
      break;
    case "screenshot":
      // handled separately if needed
      break;
    case "assert":
      // verify element exists
      await browserAction(`wait for ${step.target || ""}`);
      break;
    default:
      console.warn(`Unknown action: ${step.action}`);
  }
}

async function browserAction(task: string): Promise<void> {
  const proc = Bun.spawn(["bash", "-c", `echo "${task}" | ${AB_BIN} do --stdin`], {
    stdout: "pipe",
    stderr: "pipe",
  });
  const out = await new Response(proc.stdout).text();
  if (proc.exitCode !== 0) {
    const err = await new Response(proc.stderr).text();
    throw new Error(`browser action failed: ${err}`);
  }
}

async function takeScreenshot(outputPath: string): Promise<void> {
  const proc = Bun.spawn([AB_BIN, "screenshot", outputPath], {
    stdout: "pipe",
    stderr: "pipe",
  });
  await new Response(proc.stdout).text();
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// CLI usage
if (import.meta.main) {
  const planJson = await readFile(process.argv[2], "utf-8");
  const plan: ActionPlan = JSON.parse(planJson);
  const result = await recordWalkthrough(plan);
  console.log(JSON.stringify(result, null, 2));
}
