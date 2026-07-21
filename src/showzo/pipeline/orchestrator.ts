/**
 * orchestrator.ts — ShowZo recording pipeline orchestrator
 *
 * Exports functions that the Hono API server calls to generate plans,
 * start recordings, check progress, and retrieve outputs.
 *
 * Each recording runs as a background process (Bun.spawn → agent-browser).
 * Progress is tracked via session state persisted to disk for resilience.
 */

import { $ } from "bun";
import { readFileSync, existsSync, mkdirSync, writeFileSync, readdirSync, rmSync } from "fs";
import { basename, join } from "path";
import type { ActionPlan, RecordingSession, Step } from "./types";

// ── Constants ──────────────────────────────────────────────────────────────

const OUTPUT_BASE = "/home/workspace/showzo/output";
mkdirSync(OUTPUT_BASE, { recursive: true });

// ── Session Store (file-backed) ────────────────────────────────────────────

const SESSION_DIR = join(OUTPUT_BASE, ".sessions");
mkdirSync(SESSION_DIR, { recursive: true });

function sessionPath(id: string): string {
  return join(SESSION_DIR, `${id}.json`);
}

function saveSession(session: RecordingSession): void {
  writeFileSync(sessionPath(session.id), JSON.stringify(session, null, 2));
}

export function loadSession(id: string): RecordingSession | null {
  try {
    return JSON.parse(readFileSync(sessionPath(id), "utf-8")) as RecordingSession;
  } catch {
    return null;
  }
}

export function listSessions(): RecordingSession[] {
  const files = readdirSync(SESSION_DIR).filter((f) => f.endsWith(".json"));
  return files
    .map((f) => loadSession(f.replace(".json", "")))
    .filter((s): s is RecordingSession => s !== null);
}

// ── Plan Generation ────────────────────────────────────────────────────────

export async function generatePlan(
  url: string,
  scenario: string
): Promise<ActionPlan> {
  // If Zo API token is available, use it for LLM-based plan generation
  if (process.env.ZO_CLIENT_IDENTITY_TOKEN) {
    try {
      return await generatePlanViaZoAPI(url, scenario);
    } catch (err) {
      console.warn("Zo API plan generation failed, falling back to synthetic plan:", err);
    }
  }

  // Fallback: synthetic plan from page analysis
  return generateSyntheticPlan(url, scenario);
}

async function generatePlanViaZoAPI(
  url: string,
  scenario: string
): Promise<ActionPlan> {
  // First, fetch the page content via agent-browser to give the LLM context
  const pageSnapshot = await $`agent-browser open "${url}" --timeout 10000`
    .text()
    .catch(() => "<could not load page>");

  const prompt = `You are ShowZo, an AI that generates walkthrough video plans.
Given a URL and a scenario description, produce a structured walkthrough plan.

URL: ${url}
Scenario: ${scenario}

Page snapshot:
${pageSnapshot.slice(0, 3000)}

Respond with a JSON object with this exact structure:
{
  "title": "Short title for the walkthrough",
  "url": "${url}",
  "steps": [
    {
      "id": "1",
      "order": 1,
      "action": "navigate",
      "target": "${url}",
      "narration": "What the narrator says during this step"
    }
  ],
  "scenes": [
    {
      "order": 1,
      "title": "Scene title",
      "narration": "Full narration script for this scene",
      "duration": 10
    }
  ],
  "metadata": {
    "estimatedDuration": 45
  }
}

Rules:
- actions: navigate, click, type, scroll, wait, assert, hover, screenshot
- Each step should be a concrete browser interaction
- Narration should be clear, instructional, and ~2-3 seconds per step
- Scenes group steps into narrated segments (3-5 steps per scene)
- Keep the plan to 4-10 steps for a walkthrough video`;

  const response = await fetch("https://api.zo.computer/zo/ask", {
    method: "POST",
    headers: {
      authorization: process.env.ZO_CLIENT_IDENTITY_TOKEN!,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      input: prompt,
      model_name: "byok:b5700bd6-fca9-4aa2-9d31-bc9f5bb33bbc",
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
                pauseMs: { type: "number" },
              },
              required: ["id", "order", "action"],
            },
          },
          scenes: {
            type: "array",
            items: {
              type: "object",
              properties: {
                order: { type: "number" },
                title: { type: "string" },
                narration: { type: "string" },
                duration: { type: "number" },
              },
              required: ["order", "title", "narration", "duration"],
            },
          },
          metadata: {
            type: "object",
            properties: {
              pageTitle: { type: "string" },
              pageDescription: { type: "string" },
              estimatedDuration: { type: "number" },
            },
          },
        },
        required: ["title", "url", "steps", "scenes"],
      },
    }),
  });

  if (!response.ok) {
    throw new Error(`Zo API returned ${response.status}`);
  }

  const result: any = await response.json();
  const parsed = typeof result.output === "string" ? JSON.parse(result.output) : result.output;
  return parsed as ActionPlan;
}

function generateSyntheticPlan(url: string, scenario: string): ActionPlan {
  const steps: Step[] = [
    { id: "1", order: 1, action: "navigate", target: url, narration: `Let's start by navigating to ${url}.`, pauseMs: 1000 },
    { id: "2", order: 2, action: "wait", value: 2, narration: "Let's wait for the page to fully load.", pauseMs: 500 },
    { id: "3", order: 3, action: "screenshot", narration: "Here we see the page as it loads.", pauseMs: 500 },
    { id: "4", order: 4, action: "scroll", value: 500, narration: "Scrolling down to explore more content.", pauseMs: 500 },
    { id: "5", order: 5, action: "screenshot", narration: "The page content after scrolling.", pauseMs: 500 },
  ];

  const scenes = [
    { order: 1, title: "Introduction", narration: `Welcome to this walkthrough of ${url}. ${scenario}`, duration: 8 },
    { order: 2, title: "Exploring", narration: "Let's explore the page content.", duration: 6 },
    { order: 3, title: "Summary", narration: "And that's a quick overview of what you can do here.", duration: 5 },
  ];

  return {
    title: `Walkthrough: ${basename(new URL(url).pathname) || "home"}`,
    url,
    steps,
    scenes,
    metadata: {
      estimatedDuration: steps.length * 4,
    },
  };
}

// ── Recording Pipeline ─────────────────────────────────────────────────────

export async function startRecording(session: RecordingSession): Promise<void> {
  const id = session.id;
  const outputDir = join(OUTPUT_BASE, id);
  mkdirSync(outputDir, { recursive: true });

  // Start the recording in a background Promise
  runPipeline(id, outputDir, session).catch((err) => {
    console.error(`[${id}] Pipeline failed:`, err);
    const s = loadSession(id);
    if (s) {
      s.status = "failed";
      s.error = err instanceof Error ? err.message : String(err);
      s.log.push(`[ERROR] ${err instanceof Error ? err.message : String(err)}`);
      saveSession(s);
    }
  });
}

async function runPipeline(
  sessionId: string,
  outputDir: string,
  session: RecordingSession
): Promise<void> {
  const plan = session.plan;
  const screenshotsDir = join(outputDir, "frames");
  const interactionsFile = join(outputDir, "interactions.jsonl");
  mkdirSync(screenshotsDir, { recursive: true });

  const interactions: any[] = [];
  let elapsed = 0;
  const startTime = Date.now();

  // Phase 1: Execute steps via agent-browser
  session.status = "recording";
  saveSession(session);

  // Open page
  await runAgentCommand(`open "${plan.url}" --timeout 15000`);
  await sleep(2000);

  for (let i = 0; i < plan.steps.length; i++) {
    const step = plan.steps[i];
    const sStatus = session.stepsStatus.find((s) => s.id === step.id);
    if (sStatus) {
      sStatus.status = "running";
      session.currentStep = i;
    }
    session.log.push(`[${i + 1}/${plan.steps.length}] ${step.action}: ${step.target || step.value || ""}`);
    saveSession(session);

    try {
      switch (step.action) {
        case "navigate": {
          if (step.target) {
            await runAgentCommand(`open "${step.target}" --timeout 15000`);
            await sleep(2000);
          }
          break;
        }
        case "click": {
          if (step.target) {
            await runAgentCommand(`click "${step.target}"`);
            await sleep(step.pauseMs ?? 800);
          }
          break;
        }
        case "type": {
          if (step.target && step.value) {
            await runAgentCommand(`fill "${step.target}" "${step.value}"`);
            await sleep(step.pauseMs ?? 500);
          }
          break;
        }
        case "scroll": {
          const amount = typeof step.value === "number" ? step.value : 500;
          await runAgentCommand(`evaluate "window.scrollBy(0, ${amount})"`);
          await sleep(step.pauseMs ?? 500);
          break;
        }
        case "wait": {
          const ms = (typeof step.value === "number" ? step.value : 2) * 1000;
          await sleep(ms);
          break;
        }
        case "hover": {
          if (step.target) {
            await runAgentCommand(`hover "${step.target}"`);
            await sleep(step.pauseMs ?? 500);
          }
          break;
        }
        case "screenshot": {
          const ts = String(Date.now());
          await runAgentCommand(`screenshot "${screenshotsDir}/${ts}.png"`);
          break;
        }
        case "assert":
          // Skip assertions for capture — they're for verification
          break;
      }

      // Screenshot after each step
      const frameFile = `${screenshotsDir}/step_${String(i + 1).padStart(3, "0")}.png`;
      await runAgentCommand(`screenshot "${frameFile}"`).catch(() => {});

      // Record interaction
      interactions.push({
        step: i,
        action: step.action,
        target: step.target,
        timestamp: Date.now(),
      });

      if (sStatus) sStatus.status = "done";
    } catch (err) {
      if (sStatus) sStatus.status = "error";
      session.log.push(`[ERROR] Step ${i + 1}: ${err instanceof Error ? err.message : String(err)}`);
    }

    elapsed = Date.now() - startTime;
    session.elapsedMs = elapsed;
    saveSession(session);
  }

  // Write interactions log
  writeFileSync(interactionsFile, interactions.map((e) => JSON.stringify(e)).join("\n"));

  // Phase 2: Generate narration (TTS via Edge-TTS)
  session.status = "assembling";
  session.log.push("[ASSEMBLY] Generating narration...");
  saveSession(session);

  const narrationFile = join(outputDir, "narration.mp3");
  const subtitleFile = join(outputDir, "subtitles.srt");
  const rawVideoFile = join(outputDir, "raw.mp4");

  // Build scene-by-scene narration using Edge-TTS
  let fullNarration = "";
  let subtitleEntries: { index: number; start: number; end: number; text: string }[] = [];
  let subtitleIndex = 1;
  let subtitleOffset = 0;

  for (const scene of plan.scenes) {
    const text = scene.narration || `Step ${scene.order}`;
    fullNarration += text + " ";

    // Generate TTS for each scene
    const ttsFile = join(outputDir, `scene_${scene.order}.mp3`);
    try {
      await $`edge-tts --voice en-US-JennyNeural --text ${text} --write-media ${ttsFile}`
        .quiet()
        .timeout(30000);
    } catch {
      // If edge-tts not available, create silent audio
      await $`ffmpeg -y -f lavfi -i anullsrc=r=44100:cl=mono -t ${Math.max(text.length * 0.06, 2)} ${ttsFile}`
        .quiet()
        .timeout(10000);
    }

    // Get duration of audio
    const probe = await $`ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 ${ttsFile}`
      .text()
      .catch(() => "2");
    const sceneDuration = parseFloat(probe.trim()) || 2;

    subtitleEntries.push({
      index: subtitleIndex++,
      start: subtitleOffset,
      end: subtitleOffset + sceneDuration,
      text,
    });
    subtitleOffset += sceneDuration;
  }

  // Write subtitles
  const srtLines = subtitleEntries
    .map((e) => `${e.index}\n${formatTime(e.start)} --> ${formatTime(e.end)}\n${e.text}\n`)
    .join("\n");
  writeFileSync(subtitleFile, srtLines);

  // Concatenate all scene audio
  const concatFile = join(outputDir, "audio_concat.txt");
  const audioFiles = plan.scenes
    .map((_, i) => `file 'scene_${i + 1}.mp3'`)
    .join("\n");
  writeFileSync(concatFile, audioFiles);
  await $`ffmpeg -y -f concat -safe 0 -i ${concatFile} -c copy ${narrationFile}`
    .quiet()
    .timeout(30000);

  // Phase 3: Build final video from screenshots + narration
  session.log.push("[ASSEMBLY] Building video from frames + narration...");
  saveSession(session);

  const finalVideo = join(outputDir, "final.mp4");

  // Use ffmpeg to create a video from the screenshot frames
  const frameCount = readdirSync(screenshotsDir).filter((f) => f.endsWith(".png")).length;

  if (frameCount > 0) {
    // Calculate frame duration to match narration length
    const totalNarrationDuration = subtitleOffset || 15;
    const fps = Math.max(frameCount / totalNarrationDuration, 0.5);

    await $`ffmpeg -y -framerate ${fps} -i ${screenshotsDir}/step_%03d.png -i ${narrationFile} \
      -c:v libx264 -preset ultrafast -pix_fmt yuv420p -c:a aac -b:a 128k \
      -shortest ${finalVideo}`
      .quiet()
      .timeout(60000);
  } else {
    // Fallback: create a simple title card video
    await $`ffmpeg -y -f lavfi -i color=c=#1a1a2e:s=1280x720:d=15 \
      -vf "drawtext=text='ShowZo Walkthrough':fontcolor=white:fontsize=48:x=(w-text_w)/2:y=(h-text_h)/2" \
      -i ${narrationFile} -c:a aac -shortest ${finalVideo}`
      .quiet()
      .timeout(30000);
  }

  // Clean up raw audio files
  for (const scene of plan.scenes) {
    try { rmSync(join(outputDir, `scene_${scene.order}.mp3`)); } catch {}
  }

  session.status = "complete";
  session.videoUrl = `/api/output/${sessionId}/final.mp4`;
  session.completedAt = Date.now();
  session.log.push(`[DONE] Video ready: ${finalVideo}`);
  saveSession(session);
}

// ── Helpers ─────────────────────────────────────────────────────────────────

async function runAgentCommand(command: string): Promise<string> {
  const result = await $`agent-browser ${command}`.timeout(30000).text();
  return result.trim();
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function formatTime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  const cs = Math.floor((s - Math.floor(s)) * 100);
  return `${pad(h)}:${pad(m)}:${pad(Math.floor(s))},${pad(cs)}`;
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}
