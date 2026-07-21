#!/usr/bin/env bun
/**
 * integrate.ts — End-to-end ShowZo pipeline integration test
 *
 * Runs the full pipeline against a real page and validates each phase:
 *   1. plan.ts  →  page analysis + AI script generation
 *   2. record.ts →  agent-browser screen recording with interaction capture
 *   3. assemble.ts →  ffmpeg assembly with overlays, captions, intro/outro
 *   4. Output validation (file exists, duration, resolution)
 *
 * Usage:
 *   bun integrate.ts <url> [--intent "description"] [--output-dir ./videos]
 */

import { parseArgs } from "util";
import { mkdir, readFile } from "fs/promises";
import { join } from "path";
import { execSync } from "child_process";
import { existsSync } from "fs";
import type { ActionPlan, Session } from "./types";

const PIPELINE_DIR = import.meta.dir; // pipeline/
const ROOT = join(PIPELINE_DIR, "..");

const args = parseArgs({
  args: Bun.argv.slice(2),
  options: {
    intent: { type: "string", short: "i", default: "Show a walkthrough of this page and its key features" },
    outputDir: { type: "string", short: "o", default: join(ROOT, "output") },
  },
  allowPositionals: true,
});
const [url] = args.positionals;
if (!url) {
  console.error("Usage: bun integrate.ts <url> [--intent] [--output-dir]");
  process.exit(1);
}

const OUT = args.values.outputDir!;
const INTENT = args.values.intent!;

const SESSION: Session = {
  id: `showzo-${Date.now().toString(36)}`,
  url,
  status: "planning",
  createdAt: Date.now(),
};

await mkdir(OUT, { recursive: true });
const planFile = join(OUT, `${SESSION.id}-plan.json`);
const interactionFile = join(OUT, `${SESSION.id}-interactions.json`);
const rawVideo = join(OUT, `${SESSION.id}-raw.webm`);
const finalVideo = join(OUT, `${SESSION.id}-final.mp4`);
const subtitleFile = join(OUT, `${SESSION.id}-captions.srt`);

// ── Phase 1: Plan ─────────────────────────────────────────────────────────
console.log(`\n═══════════════════════════════════════════════`);
console.log(`  SHOWZO v0.1 — Pipeline Integration Test`);
console.log(`═══════════════════════════════════════════════`);
console.log(`\n📌 Session: ${SESSION.id}`);
console.log(`📍 URL: ${url}`);
console.log(`🎯 Intent: ${INTENT}`);
console.log(`\n─── Phase 1/3: Planning (page analysis + AI script) ───`);

const planResult = execSync(
  `bun ${join(PIPELINE_DIR, "plan.ts")} "${url}" --intent "${INTENT}" --output "${planFile}" 2>&1`,
  { encoding: "utf-8", timeout: 120_000 }
);
console.log(planResult);

if (!existsSync(planFile)) {
  throw new Error("Plan file not generated. Aborting.");
}
const plan: ActionPlan = JSON.parse(await readFile(planFile, "utf-8"));
SESSION.plan = plan;

if (!plan.steps || plan.steps.length === 0 || !plan.scenes || plan.scenes.length === 0) {
  throw new Error("Plan has no steps or scenes. Aborting.");
}

// ── Phase 2: Record ────────────────────────────────────────────────────────
SESSION.status = "recording";
console.log(`\n─── Phase 2/3: Recording (${plan.steps.length} steps, ~${plan.metadata?.estimatedDuration || 60}s) ───`);

const recordResult = execSync(
  `bun ${join(PIPELINE_DIR, "record.ts")} "${planFile}" --output "${rawVideo}" --interactions "${interactionFile}" 2>&1`,
  { encoding: "utf-8", timeout: 180_000 }
);
console.log(recordResult);

if (!existsSync(rawVideo)) {
  throw new Error("Raw video not generated. Aborting.");
}
SESSION.rawVideo = rawVideo;
SESSION.interactionLog = interactionFile;

// ── Phase 3: Assemble ──────────────────────────────────────────────────────
SESSION.status = "assembling";
console.log(`\n─── Phase 3/3: Assembly (overlays, captions, intro/outro) ───`);

const assembleResult = execSync(
  `bun ${join(PIPELINE_DIR, "assemble.ts")} \\
    --plan "${planFile}" \\
    --video "${rawVideo}" \\
    --interactions "${interactionFile}" \\
    --output "${finalVideo}" \\
    --subtitles "${subtitleFile}" 2>&1`,
  { encoding: "utf-8", timeout: 300_000 }
);
console.log(assembleResult);

if (!existsSync(finalVideo)) {
  throw new Error("Final video not generated. Aborting.");
}
SESSION.finalVideo = finalVideo;
SESSION.subtitleFile = subtitleFile;

// ── Validate ───────────────────────────────────────────────────────────────
SESSION.status = "complete";
SESSION.completedAt = Date.now();

const stats = execSync(
  `ffprobe -v quiet -print_format json -show_format -show_streams "${finalVideo}" 2>&1`,
  { encoding: "utf-8" }
);
const info = JSON.parse(stats);
const videoStream = info.streams?.find((s: any) => s.codec_type === "video");
const audioStream = info.streams?.find((s: any) => s.codec_type === "audio");
const duration = parseFloat(info.format?.duration || "0");
const size = parseInt(info.format?.size || "0");

console.log(`\n═══════════════════════════════════════════════`);
console.log(`  ✅ VIDEO READY`);
console.log(`═══════════════════════════════════════════════`);
console.log(`   Duration: ${duration.toFixed(1)}s`);
console.log(`   Resolution: ${videoStream?.width || "?"}x${videoStream?.height || "?"}`);
console.log(`   Size: ${(size / 1024 / 1024).toFixed(1)} MB`);
console.log(`   Audio: ${audioStream ? "yes" : "no"}`);
console.log(`   Subtitles: ${existsSync(subtitleFile) ? "yes" : "no"}`);
console.log(`   Output: ${finalVideo}`);
console.log(`   Plan: ${planFile}`);
console.log(`\nPipeline complete. Ready for upload/feedback.`);
