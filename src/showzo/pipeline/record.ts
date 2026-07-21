/**
 * record.ts — Phase 2: Execute walkthrough steps via agent-browser
 *
 * Drives agent-browser through each step, takes screenshots,
 * returns interaction log for the assembly phase.
 */

import { execSync, spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { ActionPlan, RecordingSession } from "./types";

const WORKDIR_BASE = "/tmp/showzo-sessions";

function sessionDir(sessionId: string): string {
  return join(WORKDIR_BASE, sessionId);
}

/** Escape a string for shell */
function esc(val: string): string {
  return val.replace(/"/g, '\\"').replace(/'/g, "'\\''");
}

function pad(n: number, w = 3): string {
  return String(n).padStart(w, "0");
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** Record a log line into session state */
function log(session: RecordingSession, line: string) {
  const ts = new Date().toISOString().slice(11, 19);
  session.log.push(`[${ts}] ${line}`);
}

/**
 * Execute the plan using agent-browser.
 * Mutates session state in-place. Each step's result is recorded.
 */
export async function executePlan(
  session: RecordingSession,
  plan: ActionPlan,
  onProgress?: (step: number, total: number, status: string) => void,
): Promise<string> {
  const dir = sessionDir(session.id);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

  const screenshotDir = join(dir, "screenshots");
  if (!existsSync(screenshotDir)) mkdirSync(screenshotDir, { recursive: true });

  const interactionLog: any[] = [];
  const startTime = Date.now();

  try {
    // ── Step 0: Navigation ────────────────────────────────────────
    log(session, `Navigating to ${plan.url}...`);
    session.currentStep = 0;
    session.stepsStatus[0] = { ...session.stepsStatus[0], status: "running" };
    onProgress?.(0, plan.steps.length, "recording");

    execSync(`agent-browser open "${esc(plan.url)}"`, {
      timeout: 20_000,
      stdio: ["pipe", "pipe", "pipe"],
    });
    await sleep(2000);
    session.stepsStatus[0] = { ...session.stepsStatus[0], status: "done" };
    log(session, `✓ Navigated to ${plan.url}`);

    // Initial screenshot
    execSync(`agent-browser screenshot "${esc(join(screenshotDir, `step_${pad(0)}.png`))}"`, {
      timeout: 15_000,
      stdio: ["pipe", "pipe", "pipe"],
    });

    // ── Steps 1..N: Execute actions ──────────────────────────────
    for (let i = 1; i < plan.steps.length; i++) {
      const step = plan.steps[i];
      session.currentStep = i;
      session.stepsStatus[i] = { ...session.stepsStatus[i], status: "running" };

      const detail = step.target
        ? `${step.action} "${step.target.slice(0, 60)}"${step.value !== undefined ? ` =${step.value}` : ""}`
        : `${step.action}${step.value !== undefined ? ` ${step.value}` : ""}`;
      log(session, `Step ${i + 1}/${plan.steps.length}: ${detail}`);
      onProgress?.(i, plan.steps.length, "recording");

      try {
        // Build the agent-browser command
        let cmd = "";
        switch (step.action) {
          case "navigate": {
            const url = String(step.value || step.target || plan.url);
            cmd = `agent-browser open "${esc(url)}"`;
            break;
          }
          case "click":
            cmd = `agent-browser click "${esc(step.target || "")}"`;
            interactionLog.push({ type: "click", target: step.target, time: Date.now() - startTime });
            break;
          case "type": {
            const val = String(step.value ?? "");
            cmd = `agent-browser type "${esc(step.target || "")}" "${esc(val)}"`;
            interactionLog.push({ type: "type", target: step.target, value: step.value, time: Date.now() - startTime });
            break;
          }
          case "scroll": {
            const amt = Number(step.value ?? 300);
            const dir2 = amt >= 0 ? "down" : "up";
            cmd = `agent-browser scroll ${dir2} ${Math.abs(amt)}`;
            interactionLog.push({ type: "scroll", direction: dir2, amount: Math.abs(amt), time: Date.now() - startTime });
            break;
          }
          case "wait": {
            await sleep(Number(step.value) || 2000);
            break;
          }
          case "hover": {
            if (step.target) cmd = `agent-browser hover "${esc(step.target)}"`;
            break;
          }
          case "screenshot":
          case "highlight":
            break; // no agent-browser action needed
          default:
            log(session, `  ⚠ Unknown action "${step.action}" — skipping`);
            break;
        }

        if (cmd) {
          execSync(cmd, { timeout: 15_000, stdio: ["pipe", "pipe", "pipe"] });
          interactionLog.push({ type: step.action, target: step.target, time: Date.now() - startTime });
        }

        // Post-step screenshot for slideshow
        const padded = pad(i);
        execSync(`agent-browser screenshot "${esc(join(screenshotDir, `step_${padded}.png`))}"`, {
          timeout: 15_000,
          stdio: ["pipe", "pipe", "pipe"],
        });

        session.stepsStatus[i] = { ...session.stepsStatus[i], status: "done" };
        log(session, `  ✓ ${detail}`);
      } catch (stepErr: any) {
        session.stepsStatus[i] = { ...session.stepsStatus[i], status: "error" };
        log(session, `  ✗ ${detail} — ${stepErr.message?.slice(0, 120) || "error"}`);
      }

      // Let page settle between steps
      if (step.pauseMs) await sleep(step.pauseMs);
      else await sleep(500);
    }

    // ── Assembly phase ────────────────────────────────────────────
    session.status = "assembling";
    session.elapsedMs = Date.now() - startTime;
    log(session, `Recording done in ${(session.elapsedMs / 1000).toFixed(1)}s.`);

    // Save metadata for assembly
    const meta = {
      sessionId: session.id,
      url: plan.url,
      title: plan.title,
      stepCount: plan.steps.length,
      screenshotDir,
      duration: session.elapsedMs,
      interactionLog,
      scenes: plan.scenes,
      createdAt: session.createdAt,
    };
    writeFileSync(join(dir, "meta.json"), JSON.stringify(meta, null, 2));

    log(session, "Assembling video from screenshots...");
    onProgress?.(plan.steps.length, plan.steps.length, "assembling");

    const outputVideo = join(dir, "final.mp4");
    await assembleVideo(screenshotDir, outputVideo, plan, session);

    session.status = "complete";
    session.videoUrl = outputVideo;
    session.completedAt = Date.now();
    log(session, `✓ Video: ${outputVideo}`);
    onProgress?.(plan.steps.length, plan.steps.length, "complete");

    return outputVideo;
  } catch (err: any) {
    session.status = "failed";
    session.error = err.message?.slice(0, 500) || "Unknown error";
    log(session, `✗ Failed: ${session.error}`);
    onProgress?.(session.currentStep, plan.steps.length, "failed");
    throw err;
  }
}

/**
 * Assemble video from screenshots using ffmpeg.
 */
async function assembleVideo(
  screenshotDir: string,
  outputPath: string,
  plan: ActionPlan,
  session: RecordingSession,
): Promise<void> {
  const files = readdirSync(screenshotDir)
    .filter((f) => f.endsWith(".png"))
    .sort();

  if (files.length === 0) {
    log(session, "  No screenshots — creating placeholder video");
    execSync(
      `ffmpeg -y -f lavfi -i color=c=#1a1a2e:s=1280x720:d=5 ` +
      `-vf "drawtext=text='ShowZo Recording Complete':fontsize=32:fontcolor=white:x=(w-text_w)/2:y=(h-text_h)/2" ` +
      `-c:v libx264 -preset ultrafast "${esc(outputPath)}"`,
      { timeout: 15_000, stdio: ["pipe", "pipe", "pipe"] },
    );
    return;
  }

  log(session, `  Assembling ${files.length} frames...`);

  // Write concat file: each image displayed for 2.5s
  const concatLines = files
    .map((f) => `file '${join(screenshotDir, f)}'\nduration 2.5`)
    .join("\n");
  writeFileSync(join(screenshotDir, "concat.txt"), concatLines);

  try {
    // Ken-burns zoompan slideshow
    execSync(
      `cd "${esc(screenshotDir)}" && ffmpeg -y -f concat -safe 0 -i concat.txt ` +
      `-vf "scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=30,"` +
      `zoompan=z='if(eq(on,1),1.0,min(1.25,zoom+0.008))':d=75:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)'" ` +
      `-c:v libx264 -preset fast -crf 23 -pix_fmt yuv420p "${esc(outputPath)}"`,
      { timeout: 180_000, stdio: ["pipe", "pipe", "pipe"] },
    );
    log(session, `  ✓ Video assembled`);
  } catch (e: any) {
    log(session, `  ⚠ ffmpeg zoompan failed: ${e.message?.slice(0, 80)} — fallback to simple concat`);
    // Fallback: simple concat title per image
    try {
      execSync(
        `cd "${esc(screenshotDir)}" && ffmpeg -y -f concat -safe 0 -i concat.txt ` +
        `-c:v libx264 -preset fast -crf 23 -pix_fmt yuv420p -vf "fps=30,"` +
        `scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2" ` +
        `"${esc(outputPath)}"`,
        { timeout: 180_000, stdio: ["pipe", "pipe", "pipe"] },
      );
      log(session, `  ✓ Video assembled (fallback)`);
    } catch (e2: any) {
      log(session, `  ✗ Assembly failed: ${e2.message?.slice(0, 100)}`);
      throw e2;
    }
  }
}
