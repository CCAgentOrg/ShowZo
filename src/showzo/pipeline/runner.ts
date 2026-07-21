import { $, sleep } from "bun";
import { existsSync, mkdirSync, writeFileSync, readFileSync, copyFileSync } from "fs";
import { join } from "path";
import type { Plan, Step, Session, StepRecordState } from "./types";

/** Edge TTS voice configuration */
const TTS_VOICE = "en-US-JennyNeural";
const TTS_SPEED = "+10%";

/**
 * Main recording orchestrator.
 * Runs agent-browser to execute plan steps and records screenshots,
 * generates TTS narration, and assembles the final video.
 */
export async function runRecordingPipeline(
  plan: Plan,
  sessionId: string,
  onProgress: (update: Partial<Session>) => void,
): Promise<string> {
  const sessionDir = `/tmp/showzo-sessions/${sessionId}`;
  const screenshotsDir = join(sessionDir, "screenshots");
  const audioDir = join(sessionDir, "audio");
  const outputDir = join(sessionDir, "output");

  // Create working directories
  for (const dir of [sessionDir, screenshotsDir, audioDir, outputDir]) {
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  }

  const startTime = Date.now();
  const stepStates: StepRecordState[] = plan.steps.map((s) => ({
    id: s.id,
    order: s.order,
    action: s.action,
    narration: s.narration,
    status: "pending",
  }));

  function elapsed(): number {
    return Date.now() - startTime;
  }

  function emit(update: Partial<Session>) {
    onProgress({
      steps: stepStates,
      currentStep: stepStates.filter((s) => s.status === "done").length,
      elapsedMs: elapsed(),
      ...update,
    });
  }

  emit({ status: "recording", startedAt: startTime });

  try {
    // Open agent-browser to the target URL
    log(sessionId, `Navigating to ${plan.url}`);
    await $`agent-browser open ${plan.url}`.quiet();
    await sleep(2000); // Wait for page to load

    // Take initial screenshot
    const initScreenshot = join(screenshotsDir, "step_000.png");
    await $`agent-browser screenshot ${initScreenshot}`.quiet();

    // Execute each step
    for (let i = 0; i < plan.steps.length; i++) {
      const step = plan.steps[i];
      stepStates[i].status = "running";
      emit({ status: "recording" });

      try {
        await executeStep(step);
        log(sessionId, `Step ${step.order}: ${step.action} completed`);

        // Take screenshot after step
        const screenshotPath = join(screenshotsDir, `step_${String(step.order).padStart(3, "0")}.png`);
        await $`agent-browser screenshot ${screenshotPath}`.quiet();
        stepStates[i].screenshotPath = screenshotPath;

        // Generate narration audio
        if (step.narration && step.narration.length > 3) {
          const audioPath = join(audioDir, `step_${String(step.order).padStart(3, "0")}.mp3`);
          await generateTTS(step.narration, audioPath);
          stepStates[i].narrationAudio = audioPath;
          // Rough duration: ~150 words/min, so estimate from text length
          stepStates[i].narrationDuration = Math.max(3, Math.ceil(step.narration.length / 80) + 1);
        }

        stepStates[i].status = "done";
      } catch (stepErr) {
        const msg = stepErr instanceof Error ? stepErr.message : String(stepErr);
        log(sessionId, `Step ${step.order} failed: ${msg}`);
        stepStates[i].status = "error";
        stepStates[i].errorMessage = msg;
      }

      emit({});
    }

    // All steps done — assemble the video
    emit({ status: "assembling" });
    log(sessionId, "All steps recorded. Assembling video...");

    const finalVideo = await assembleVideo(sessionId, plan, stepStates, screenshotsDir, audioDir, outputDir);
    log(sessionId, `Video assembled: ${finalVideo}`);

    emit({
      status: "completed",
      completedAt: Date.now(),
      finalVideo,
    });

    return finalVideo;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log(sessionId, `Pipeline failed: ${msg}`);
    emit({
      status: "failed",
      error: msg,
      completedAt: Date.now(),
    });
    throw err;
  }
}

/** Execute a single step action using agent-browser */
async function executeStep(step: Step): Promise<void> {
  switch (step.action) {
    case "navigate":
      if (step.target) {
        await $`agent-browser open ${step.target}`.quiet();
        await sleep(2000);
      }
      break;

    case "click":
      if (step.target) {
        await $`agent-browser click ${step.target}`.quiet();
        await sleep(1000);
      }
      break;

    case "type":
      if (step.target && step.value) {
        await $`agent-browser type ${step.target} ${step.value}`.quiet();
        await sleep(500);
      }
      break;

    case "scroll":
      const px = typeof step.value === "number" ? step.value : 500;
      await $`agent-browser scroll down ${px}`.quiet();
      await sleep(500);
      break;

    case "wait":
      const ms = typeof step.value === "number" ? step.value : 2000;
      await sleep(ms);
      break;

    case "screenshot":
      // Screenshots are taken after each step by the orchestrator
      break;

    case "hover":
      if (step.target) {
        await $`agent-browser hover ${step.target}`.quiet();
        await sleep(300);
      }
      break;

    case "press":
      if (step.value) {
        await $`agent-browser press ${step.value}`.quiet();
        await sleep(300);
      }
      break;

    default:
      log(sessionId, `Unknown action: ${step.action}, skipping`);
  }
}

/** Generate TTS audio using edge-tts */
async function generateTTS(text: string, outputPath: string): Promise<void> {
  // Sanitize text for shell
  const sanitized = text
    .replace(/["\\]/g, "")
    .replace(/\n/g, " ")
    .trim();

  await $`edge-tts --voice ${TTS_VOICE} --text ${sanitized} --write-media ${outputPath}`.quiet();
}

/**
 * Assemble the final video from screenshots + narration.
 * Uses ffmpeg to create a slideshow with crossfade transitions,
 * TTS audio overlay, and text burns.
 */
async function assembleVideo(
  sessionId: string,
  plan: Plan,
  stepStates: StepRecordState[],
  screenshotsDir: string,
  audioDir: string,
  outputDir: string,
): Promise<string> {
  const videoPath = join(outputDir, "walkthrough.mp4");
  const completedSteps = stepStates.filter((s) => s.status === "done" && existsSync(s.screenshotPath));

  if (completedSteps.length === 0) {
    throw new Error("No completed steps with screenshots to assemble");
  }

  // Generate concat file for ffmpeg
  let ffmpegInputs: string[] = [];
  let filterParts: string[] = [];
  let concatParts: string[] = [];
  let totalDuration = 0;

  // For each step, create a video segment with screenshot + optional audio
  for (let i = 0; i < completedSteps.length; i++) {
    const step = completedSteps[i];
    const screenshot = step.screenshotPath!;
    const duration = Math.max(3, step.narrationDuration || 5);

    // Input label
    const label = `s${i}`;
    ffmpegInputs.push(`-loop 1 -framerate 30 -t ${duration} -i ${screenshot}`);

    if (step.narrationAudio && existsSync(step.narrationAudio)) {
      const audioLabel = `a${i}`;
      ffmpegInputs.push(`-i ${step.narrationAudio}`);
      filterParts.push(`[${label}]drawtext=text='${sanitizeForFFmpeg(step.narration)}':fontfile=/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf:fontsize=24:fontcolor=white:box=1:boxcolor=black@0.5:boxborderw=10:x=(w-tw)/2:y=h-th-40:enable='between(t,0,${duration})'[v${i}];`);
      concatParts.push(`[v${i}][${audioLabel}]`);
    } else {
      filterParts.push(`[${label}]drawtext=text='${sanitizeForFFmpeg(step.narration)}':fontfile=/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf:fontsize=24:fontcolor=white:box=1:boxcolor=black@0.5:boxborderw=10:x=(w-tw)/2:y=h-th-40:enable='between(t,0,${duration})'[v${i}];`);
      concatParts.push(`[v${i}]`);
    }

    totalDuration += duration;
  }

  // Build final concat filter
  const concatFilter = filterParts.join("\n") + `\n${concatParts.join("")}concat=n=${completedSteps.length}:v=1:a=${completedSteps.filter(s => s.narrationAudio && existsSync(s.narrationAudio)).length}[v][a]`;

  // Build ffmpeg command
  const cmd = `ffmpeg -y ${ffmpegInputs.join(" ")} -filter_complex "${concatFilter}" -map "[v]" ${
    completedSteps.some(s => s.narrationAudio && existsSync(s.narrationAudio)) ? '-map "[a]"' : "-an"
  } -c:v libx264 -preset fast -crf 23 -pix_fmt yuv420p ${videoPath}`;

  log(sessionId, `FFmpeg: assembling ${completedSteps.length} scenes → ${videoPath}`);

  // Write the command to a file for debugging
  writeFileSync(join(screenshotsDir, "..", "ffmpeg_cmd.txt"), cmd);

  // Run ffmpeg with a 10-minute timeout
  await $`timeout 600 sh -c ${cmd}`.quiet();

  if (!existsSync(videoPath)) {
    throw new Error("ffmpeg failed to produce output video");
  }

  return videoPath;
}

/** Sanitize text for ffmpeg drawtext filter (escape single quotes and colons) */
function sanitizeForFFmpeg(text: string): string {
  return text
    .replace(/'/g, "'\\\\''")
    .replace(/:/g, "\\\\:")
    .replace(/"/g, '\\"')
    .replace(/\n/g, " ")
    .trim();
}

/** Reusable temp log helper (in-memory — use for server console) */
let sessionId: string = "";

function log(sid: string, msg: string) {
  sessionId = sid;
  console.log(`[ShowZo:${sid.slice(-8)}] ${msg}`);
}

// Also store logs per session (for API polling)
const sessionLogs = new Map<string, string[]>();

export function appendLog(sessionId: string, msg: string) {
  if (!sessionLogs.has(sessionId)) sessionLogs.set(sessionId, []);
  sessionLogs.get(sessionId)!.push(msg);
  log(sessionId, msg);
}

export function getLogs(sessionId: string): string[] {
  return sessionLogs.get(sessionId) || [];
}
