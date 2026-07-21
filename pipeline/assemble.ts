/**
 * assemble.ts — Narration + video assembly (Pass 2)
 *
 * After the raw recording is done, this module:
 *  1. Generates TTS narration for each step
 *  2. Creates subtitle segments (.srt)
 *  3. Overlays narration + subtitles onto the raw video
 *  4. Adds intro/outro title cards
 *  5. Outputs final production-ready MP4
 */

import { $ } from "bun";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import type { ActionPlan, RecordingResult } from "./types";

interface AssemblyInput {
  plan: ActionPlan;
  recording: RecordingResult;
  outputFile?: string;
  /** Optional watermark / logo image */
  brandImage?: string;
}

interface AssemblyResult {
  outputFile: string;
  duration: number; // seconds
}

// Download TTS audio for a text segment using Edge TTS
async function generateNarration(text: string, outputPath: string): Promise<void> {
  const proc = Bun.spawn([
    "edge-tts",
    "--voice", "en-US-JennyNeural",
    "--text", text,
    "--write-media", outputPath,
  ], { stdout: "pipe", stderr: "pipe" });

  const status = await proc.exited;
  if (status !== 0) {
    // Fallback to gTTS if edge-tts not available
    const err = await new Response(proc.stderr).text();
    console.warn("edge-tts failed, trying gtts:", err);
    const proc2 = Bun.spawn([
      "python3", "-c", `from gtts import gTTS; gTTS(text="""${text.replace(/"/g, '\\"')}""", lang="en").save("${outputPath}")`
    ]);
    await proc2.exited;
  }
}

// Create SRT subtitle content from timing data
function createSrt(wavFile: string, narration: string, startMs: number): { srt: string; durationMs: number } {
  // For now, assume 3 words per second as rough duration estimate
  // In production, we'd use ffprobe to get exact duration
  const wordCount = narration.split(/\s+/).length;
  const durationMs = Math.max(wordCount * 250, 1500); // ~250ms per word, min 1.5s

  const startS = Math.floor(startMs / 1000);
  const startF = startMs % 1000;
  const endMs = startMs + durationMs;
  const endS = Math.floor(endMs / 1000);
  const endF = endMs % 1000;

  const toTimestamp = (s: number, f: number) =>
    `${String(Math.floor(s / 3600)).padStart(2, "0")}:${String(Math.floor((s % 3600) / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")},${String(f).padStart(3, "0")}`;

  const srt = `1
${toTimestamp(startS, startF)} --> ${toTimestamp(endS, endF)}
${narration}`;

  return { srt, durationMs };
}

/**
 * Full assembly pipeline: generate narration, mix with raw video, produce final output.
 */
export async function assembleWalkthrough(input: AssemblyInput): Promise<AssemblyResult> {
  const { plan, recording } = input;
  const outputFile = input.outputFile || join(recording.workDir, "showzo-walkthrough.mp4");
  const workDir = join(recording.workDir, "assembly");
  if (!existsSync(workDir)) await mkdir(workDir, { recursive: true });

  const rawVideo = recording.rawVideoPath;
  if (!existsSync(rawVideo)) throw new Error(`Raw recording not found: ${rawVideo}`);

  // --- Generate narration audio per step ---
  const audioFiles: string[] = [];
  const srtParts: string[] = [];
  let currentMs = 0;

  for (let i = 0; i < plan.steps.length; i++) {
    const step = plan.steps[i];
    if (!step.narration) continue;

    const wavFile = join(workDir, `narration-${String(i).padStart(3, "0")}.mp3`);
    console.log(`[narration ${i + 1}/${plan.steps.length}] "${step.narration.slice(0, 60)}..."`);
    await generateNarration(step.narration, wavFile);
    audioFiles.push(wavFile);

    const { srt, durationMs } = createSrt(wavFile, step.narration, currentMs);
    srtParts.push(`\n${srt}`);
    currentMs += durationMs + 500; // +500ms gap between narrations
  }

  // Write SRT file
  const srtPath = join(workDir, "subtitles.srt");
  await writeFile(srtPath, srtParts.join("\n"));

  // --- Concatenate narration audio ---
  const concatAudio = join(workDir, "narration-concat.mp3");
  if (audioFiles.length > 0) {
    const fileList = audioFiles.map(f => `file '${f}'`).join("\n");
    await writeFile(join(workDir, "audio-list.txt"), fileList);
    await $`ffmpeg -y -f concat -safe 0 -i ${join(workDir, "audio-list.txt")} -c copy ${concatAudio}`.quiet();
  }

  // --- Get raw video duration ---
  const durationOutput = await $`ffprobe -v quiet -show_entries format=duration -of csv=p=0 ${rawVideo}`.text();
  const rawDuration = parseFloat(durationOutput.trim()) || 60;

  // --- Build ffmpeg filter complex ---
  // Mix narration audio, add subtitles, add subtle progress indicator at bottom
  console.log("Assembling final video...");

  if (audioFiles.length > 0) {
    // With narration audio
    await $`
      ffmpeg -y \
        -i ${rawVideo} \
        -i ${concatAudio} \
        -c:v libx264 -preset medium -crf 23 \
        -c:a aac -b:a 128k \
        -filter_complex "[1:a]adelay=1000|1000[aud];[0:a][aud]amix=inputs=2:duration=first[aout]" \
        -map 0:v -map "[aout]" \
        -vf "subtitles=${srtPath}" \
        -movflags +faststart \
        -t ${rawDuration} \
        ${outputFile}
    `.quiet();
  } else {
    // Raw video only, add subtitles
    await $`
      ffmpeg -y \
        -i ${rawVideo} \
        -c:v libx264 -preset medium -crf 23 \
        -c:a aac -b:a 128k \
        -vf "subtitles=${srtPath}" \
        -movflags +faststart \
        ${outputFile}
    `.quiet();
  }

  // --- Verify output ---
  const finalDuration = (await $`ffprobe -v quiet -show_entries format=duration -of csv=p=0 ${outputFile}`.text()).trim();

  console.log(`Final video: ${outputFile} (${finalDuration}s)`);

  return {
    outputFile,
    duration: parseFloat(finalDuration) || 0,
  };
}

// CLI usage
if (import.meta.main) {
  const recordingData = JSON.parse(await readFile(process.argv[2], "utf-8"));
  const planData = JSON.parse(await readFile(process.argv[3], "utf-8"));

  const input: AssemblyInput = {
    plan: planData,
    recording: recordingData,
    outputFile: process.argv[4],
  };

  const result = await assembleWalkthrough(input);
  console.log(JSON.stringify(result, null, 2));
}
