#!/usr/bin/env bun
/**
 * assemble.ts — Phase 3: Narration + zoom + cursor overlays + captions + intro/outro.
 *
 * Takes raw recording + plan + interaction log, produces polished MP4.
 * Supports auto-zoom to scene targets, cursor overlay at click positions,
 * TTS narration, intro/outro cards, and subtitle burning.
 *
 * Usage:
 *   bun assemble.ts --plan plan.json --video raw.mp4 --interactions interactions.json
 *                   --output final.mp4 --subtitles captions.srt
 */

import { parseArgs } from "util";
import { $ } from "bun";
import { existsSync } from "fs";
import { mkdir, readFile, writeFile, rm, copyFile } from "fs/promises";
import { join, dirname } from "path";
import { spawnSync } from "child_process";

interface Scene {
  order: number;
  title: string;
  narration: string;
  duration: number;
  zoomTarget?: { x: number; y: number; scale: number };
  stepRange?: [number, number];
}

interface Plan {
  title: string;
  url: string;
  steps: { order: number; description: string; narration?: string }[];
  scenes: Scene[];
  metadata?: { pageTitle?: string; estimatedDuration?: number };
}

interface InteractionEvent {
  type: string;
  timestamp: number; // ms from start
  data: { x?: number; y?: number; target?: string; selector?: string; scrollY?: number };
}

const args = parseArgs({
  args: Bun.argv.slice(2),
  options: {
    plan: { type: "string", short: "p" },
    video: { type: "string", short: "v" },
    interactions: { type: "string", short: "i" },
    output: { type: "string", short: "o" },
    subtitles: { type: "string", short: "s" },
    fps: { type: "string", default: "30" },
    help: { type: "boolean", short: "h" },
  },
});

if (args.values.help || !args.values.plan || !args.values.video || !args.values.output) {
  console.log(`ShowZo — Assemble Phase
Usage: bun assemble.ts --plan plan.json --video raw.mp4 --interactions interactions.json
                        --output final.mp4 --subtitles captions.srt [--fps 30]`);
  process.exit(0);
}

export async function assembleVideo(
  plan: Plan,
  rawVideo: string,
  outputDir: string,
): Promise<{ finalVideo: string; subtitleFile: string }> {
  const fps = parseInt(args.values.fps || "30");
  const out = outputDir;
  const scenes = plan.scenes;
  const interactions: InteractionEvent[] = [];
  const subtitleFile = args.values.subtitles || join(out, "captions.srt");
  const finalVideo = args.values.output || join(out, "final.mp4");

  // Read interaction log if available
  const interactionsPath = args.values.interactions;
  if (interactionsPath && existsSync(interactionsPath)) {
    const raw = await readFile(interactionsPath, "utf-8");
    interactions.push(...JSON.parse(raw));
  }

  const sceneDir = join(out, "scenes");
  const audioDir = join(out, "audio");
  await mkdir(sceneDir, { recursive: true });
  await mkdir(audioDir, { recursive: true });

  // ── 1. Generate TTS narration for each scene ─────────────────────────
  console.log(`  🔊 Generating narration (${scenes.length} scenes)...`);
  const audioFiles: { path: string; duration: number }[] = [];
  let narrationDuration = 0;

  for (const scene of scenes) {
    if (!scene.narration?.trim()) {
      const silence = join(audioDir, `scene-${scene.order}-silence.mp3`);
      spawnSync("ffmpeg", [
        "-y", "-f", "lavfi", "-i", "anullsrc=r=44100:cl=mono",
        "-t", String(scene.duration), "-c:a", "libmp3lame", silence,
      ], { stdio: "ignore" });
      audioFiles.push({ path: silence, duration: scene.duration });
      narrationDuration += scene.duration;
      continue;
    }

    const audioPath = join(audioDir, `scene-${scene.order}.mp3`);
    try {
      const tts = spawnSync("edge-tts", [
        "--voice", "en-US-JennyNeural",
        "--text", scene.narration,
        "--write-media", audioPath,
        "--write-subtitles", audioPath.replace(".mp3", ".srt"),
      ], { timeout: 60_000, stdio: "pipe" });

      if (tts.status !== 0) throw new Error(`edge-tts exit ${tts.status}`);

      const probe = spawnSync("ffprobe", [
        "-v", "quiet", "-show_entries", "format=duration",
        "-of", "default=noprint_wrappers=1:nokey=1", audioPath,
      ], { stdio: "pipe" });
      const actualDur = parseFloat(probe.stdout.toString().trim()) || scene.duration;
      audioFiles.push({ path: audioPath, duration: Math.max(actualDur, scene.duration) });
      narrationDuration += Math.max(actualDur, scene.duration);
    } catch {
      spawnSync("ffmpeg", [
        "-y", "-f", "lavfi", "-i", "anullsrc=r=44100:cl=mono",
        "-t", String(scene.duration), "-c:a", "libmp3lame", audioPath,
      ], { stdio: "ignore" });
      audioFiles.push({ path: audioPath, duration: scene.duration });
      narrationDuration += scene.duration;
    }
  }

  // ── 1b. Generate cursor overlay PNG ──────────────────────────────────
  const cursorPng = join(out, "cursor.png");
  if (!existsSync(cursorPng)) {
    spawnSync("convert", [
      "-size", "36x36", "xc:transparent",
      "-fill", "#2a2a2a",
      "-draw", "path 'M 2,2 L 2,28 L 9,21 L 14,32 L 18,31 L 12,19 L 22,18 Z'",
      "-fill", "#ffffff",
      "-draw", "path 'M 4,5 L 4,24 L 9,19 L 13,28 L 16,27 L 11,18 L 19,17 Z'",
      "-alpha", "set",
      "PNG32:" + cursorPng,
    ], { stdio: "ignore" });
  }

  // ── 2. Generate scene segments with zoom + cursor overlay ────────────
  console.log(`  🔍 Applying scene zoom + cursor overlay...`);
  const segmentFiles: string[] = [];
  let rawDuration: number | null = null;

  const durProbe = spawnSync("ffprobe", [
    "-v", "quiet", "-show_entries", "format=duration",
    "-of", "default=noprint_wrappers=1:nokey=1", rawVideo,
  ], { stdio: "pipe" });
  rawDuration = parseFloat(durProbe.stdout.toString().trim()) || 60;

  const totalSceneDur = scenes.reduce((s, sc) => s + Math.max(sc.duration, 2), 0);
  const VIEWPORT = { w: 1280, h: 720 };
  const CX = VIEWPORT.w / 2, CY = VIEWPORT.h / 2;

  // Pre-process interactions: sort and map timestamps
  const clickEvents = interactions
    .filter(e => e.type === "click" && e.data.x != null && e.data.y != null)
    .map(e => ({ ts: e.timestamp / 1000, x: e.data.x!, y: e.data.y! }));
  const allEvents = interactions
    .filter(e => (e.type === "click" || e.type === "mousemove") && e.data.x != null && e.data.y != null)
    .sort((a, b) => a.timestamp - b.timestamp);

  function getClickInRange(startSec: number, endSec: number): { x: number; y: number } | null {
    const inRange = clickEvents.filter(e => e.ts >= startSec && e.ts <= endSec);
    if (inRange.length > 0) return { x: inRange[inRange.length - 1].x, y: inRange[inRange.length - 1].y };
    // Fallback: use any event in range
    const allInRange = allEvents.filter(e => (e.timestamp / 1000) >= startSec && (e.timestamp / 1000) <= endSec);
    if (allInRange.length > 0) return { x: allInRange[allInRange.length - 1].data.x!, y: allInRange[allInRange.length - 1].data.y! };
    return null;
  }

  let rawTimeCursor = 0;
  for (let si = 0; si < scenes.length; si++) {
    const scene = scenes[si];
    const sceneDur = Math.max(scene.duration, 2);
    const sceneRawDur = (sceneDur / totalSceneDur) * rawDuration!;
    const rawStart = rawTimeCursor;
    const rawEnd = Math.min(rawTimeCursor + sceneRawDur, rawDuration!);
    rawTimeCursor = rawEnd;

    const segPath = join(sceneDir, `scene-${scene.order}.mp4`);
    segmentFiles.push(segPath);

    const trimStart = rawStart.toFixed(2);
    const trimDur = Math.max(rawEnd - rawStart, 1.0).toFixed(2);
    const frames = Math.round(sceneDur * fps);

    // Zoom target from plan or interaction position
    const zt = scene.zoomTarget;
    const cursorPos = getClickInRange(rawStart, rawEnd);
    const zoomCenterX = zt?.x ?? (cursorPos?.x ?? CX);
    const zoomCenterY = zt?.y ?? (cursorPos?.y ?? CY);
    const zoomScale = zt?.scale ?? 1.8;

    // Offset from viewport center (normalized)
    const offX = (zoomCenterX - CX).toFixed(1);
    const offY = (zoomCenterY - CY).toFixed(1);

    // Zoompan filter: zoom into target with ease-in/out
    const zoomFilter = [
      `trim=start=${trimStart}:duration=${trimDur}`,
      "setpts=PTS-STARTPTS",
      `zoompan=z='if(between(on,0,15),1+(${zoomScale}-1)*(on/15),` +
        `if(between(on,${frames - 15},${frames}),` +
        `${zoomScale}-(${zoomScale}-1)*((on-${frames - 15})/15),` +
        `${zoomScale}))':` +
        `x='if(between(on,0,15),iw/2-(iw/zoom/2)+${offX}/zoom,` +
        `if(between(on,${frames - 15},${frames}),` +
        `iw/2-(iw/zoom/2)+${offX}/zoom,` +
        `iw/2-(iw/zoom/2)+${offX}/zoom))':` +
        `y='if(between(on,0,15),ih/2-(ih/zoom/2)+${offY}/zoom,` +
        `if(between(on,${frames - 15},${frames}),` +
        `ih/2-(ih/zoom/2)+${offY}/zoom,` +
        `ih/2-(ih/zoom/2)+${offY}/zoom))':` +
        `s=${VIEWPORT.w}x${VIEWPORT.h}:d=${frames}`,
    ].join(",");

    // Determine cursor screen position at the zoomed scale.
    // After zoompan, the output is 1280x720 but the visible content
    // is the zoomed-in region. We scale the cursor position by the zoom factor
    // from the raw video coordinates.
    const cursorScreenX = (cursorPos?.x ?? CX) * zoomScale - (zoomScale - 1) * CX;
    const cursorScreenY = (cursorPos?.y ?? CY) * zoomScale - (zoomScale - 1) * CY;

    // Cursor overlay + click ripple effects
    const overlayFilters: string[] = [];

    // Main cursor overlay (visible throughout scene)
    overlayFilters.push(
      `overlay=${cursorScreenX.toFixed(1)}:${(cursorScreenY - 4).toFixed(1)}:enable='between(t,0,${sceneDur.toFixed(1)})'`
    );

    // Click ripples: expanding circle at click positions
    for (const click of clickEvents) {
      const clickSceneTs = (click.ts - rawStart) * (sceneDur / sceneRawDur); // map to scene time
      if (clickSceneTs < 0 || clickSceneTs > sceneDur) continue;

      const csX = click.x * zoomScale - (zoomScale - 1) * CX;
      const csY = click.y * zoomScale - (zoomScale - 1) * CY;

      // Click ripple: expanding circle that fades over 0.5s
      // Use a semi-transparent circle via drawtext or geq
      overlayFilters.push(
        `drawtext=text='◉':fontsize=24:fontcolor=red@0.8:fontfile=/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf:` +
        `x=${csX.toFixed(1) - 12}:y=${csY.toFixed(1) - 12}:` +
        `enable='between(t,${clickSceneTs.toFixed(2)},${(clickSceneTs + 0.5).toFixed(2)})'`
      );
    }

    const fullFilter = zoomFilter + "," + overlayFilters.join(",");

    const cmd = [
      "ffmpeg", "-y",
      "-i", rawVideo,
      "-i", cursorPng,
      "-filter_complex", fullFilter,
      "-c:v", "libx264", "-preset", "fast", "-crf", "22",
      "-an", segPath,
    ];
    spawnSync(cmd[0], cmd.slice(1), { stdio: "ignore" });
  }

  // ── 3. Generate intro/outro cards ──────────────────────────────────
  console.log(`  🃏 Generating intro/outro cards...`);
  const introOutDir = join(out, "intro-cards");
  await mkdir(introOutDir, { recursive: true });

  const scriptDir = dirname(import.meta.dir || ".");
  const introPy = join(scriptDir, "..", "scripts", "gen-intro-outro.py");
  if (existsSync(introPy)) {
    spawnSync("python3", [
      introPy,
      "--title", (plan.title || "Walkthrough").substring(0, 60),
      "--subtitle", `ShowZo — ${plan.url?.replace(/https?:\/\//, "").substring(0, 50) || "Walkthrough"}`,
      "--output-dir", introOutDir,
      "--fps", String(fps),
      "--width", "1280", "--height", "720",
      "--intro-duration", "3", "--outro-duration", "3",
    ], { stdio: "ignore" });
  }

  // Encode intro/outto frames to video
  const introVideo = join(out, "intro.mp4");
  const outroVideo = join(out, "outro.mp4");

  if (existsSync(join(introOutDir, "intro_concat.txt"))) {
    spawnSync("ffmpeg", ["-y", "-f", "concat", "-safe", "0",
      "-i", join(introOutDir, "intro_concat.txt"),
      "-c:v", "libx264", "-preset", "fast", "-pix_fmt", "yuv420p",
      "-r", String(fps), introVideo,
    ], { stdio: "ignore" });
  } else {
    // Generate a simple intro card using ffmpeg drawtext
    spawnSync("ffmpeg", ["-y", "-f", "lavfi", "-i", `color=c=#1a1a2e:s=1280x720:d=3:r=${fps}`,
      "-vf", `drawtext=text='${(plan.title || "Walkthrough").replace(/'/g, "'\\\\''")}':` +
        "fontsize=48:fontcolor=white:x=(w-text_w)/2:y=(h-text_h)/2-40:" +
        "fontfile=/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf," +
        `drawtext=text='${plan.url?.replace(/https?:\/\//, "").substring(0, 50) || ""}':` +
        "fontsize=24:fontcolor=#aaaaaa:x=(w-text_w)/2:y=(h-text_h)/2+20:" +
        "fontfile=/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
      "-c:v", "libx264", "-preset", "fast", "-pix_fmt", "yuv420p", introVideo,
    ], { stdio: "ignore" });
  }

  if (existsSync(join(introOutDir, "outro_concat.txt"))) {
    spawnSync("ffmpeg", ["-y", "-f", "concat", "-safe", "0",
      "-i", join(introOutDir, "outro_concat.txt"),
      "-c:v", "libx264", "-preset", "fast", "-pix_fmt", "yuv420p",
      "-r", String(fps), outroVideo,
    ], { stdio: "ignore" });
  } else {
    spawnSync("ffmpeg", ["-y", "-f", "lavfi", "-i", `color=c=#16213e:s=1280x720:d=3:r=${fps}`,
      "-vf", "drawtext=text='Made with ShowZo':" +
        "fontsize=36:fontcolor=white:x=(w-text_w)/2:y=(h-text_h)/2-30:" +
        "fontfile=/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf," +
        "drawtext=text='github.com/CCAgentOrg/ShowZo':" +
        "fontsize=18:fontcolor=#aaaaaa:x=(w-text_w)/2:y=(h-text_h)/2+20:" +
        "fontfile=/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
      "-c:v", "libx264", "-preset", "fast", "-pix_fmt", "yuv420p", outroVideo,
    ], { stdio: "ignore" });
  }

  // ── 4. Generate subtitles ──────────────────────────────────────────
  console.log(`  📝 Generating subtitles...`);
  const srtLines: string[] = [];
  let captionsStartTime = 3; // after 3s intro
  let seqNum = 1;

  for (const scene of scenes) {
    const audioDur = audioFiles[scenes.indexOf(scene)]?.duration || scene.duration;
    const text = scene.narration?.trim();
    if (!text) { captionsStartTime += audioDur; continue; }

    const words = text.split(/\s+/);
    let chunk: string[] = [];
    let chunkStart = captionsStartTime;
    const maxChars = 40;

    for (let wi = 0; wi < words.length; wi++) {
      chunk.push(words[wi]);
      const joined = chunk.join(" ");
      if (joined.length >= maxChars || wi === words.length - 1) {
        const frac = chunk.length / words.length;
        const chunkEnd = chunkStart + frac * audioDur;
        srtLines.push(String(seqNum++));
        srtLines.push(`${fmtSrt(chunkStart)} --> ${fmtSrt(chunkEnd)}`);
        srtLines.push(joined);
        srtLines.push("");
        chunkStart = chunkEnd;
        chunk = [];
      }
    }
    captionsStartTime += audioDur;
  }
  await writeFile(subtitleFile, srtLines.join("\n"));

  // ── 5. Concat everything ───────────────────────────────────────────
  console.log(`  🎬 Compositing final video...`);
  const concatPath = join(out, "segments.txt");
  const allSegments = [introVideo, ...segmentFiles, outroVideo].filter(f => existsSync(f));
  const concatLines = allSegments.map(f => `file '${f}'`);
  await writeFile(concatPath, concatLines.join("\n"));

  // Concatenate audio files
  const audioConcatParts = audioFiles.map((af) => {
    const extracted = join(audioDir, `concat-${audioFiles.indexOf(af)}.m4a`);
    spawnSync("ffmpeg", ["-y", "-i", af.path, "-c:a", "aac", "-b:a", "128k", extracted], { stdio: "ignore" });
    return extracted;
  });

  const audioConcatPath = join(out, "audio_concat.txt");
  await writeFile(audioConcatPath, audioConcatParts.map(f => `file '${f}'`).join("\n"));

  const finalAudio = join(out, "narration.mp3");
  spawnSync("ffmpeg", ["-y", "-f", "concat", "-safe", "0",
    "-i", audioConcatPath, "-c:a", "aac", "-b:a", "128k", finalAudio,
  ], { stdio: "ignore" });

  // Final composition: concat video + overlay audio + burn subtitles
  const subStyle = "FontName=DejaVuSans-Bold,FontSize=18,PrimaryColour=&HCCFFFFFF,OutlineColour=&H80000000,BorderStyle=3,Alignment=2";
  const finalCmd = [
    "ffmpeg", "-y",
    "-f", "concat", "-safe", "0", "-i", concatPath,
    "-i", finalAudio,
    "-c:v", "libx264", "-preset", "medium", "-crf", "20",
    "-c:a", "aac", "-b:a", "128k",
    "-vf", `subtitles=${subtitleFile}:force_style='${subStyle}'`,
    "-shortest", finalVideo,
  ];
  spawnSync(finalCmd[0], finalCmd.slice(1), { stdio: "ignore" });

  // Cleanup intermediate files
  try {
    await rm(sceneDir, { recursive: true, force: true });
    await rm(introOutDir, { recursive: true, force: true });
  } catch {}

  console.log(`  ✅ Output: ${finalVideo}`);
  return { finalVideo, subtitleFile };
}

// ── Main entry point ──────────────────────────────────────────────────────
async function main() {
  const planPath = args.values.plan!;
  const rawVideo = args.values.video!;
  const outputPath = args.values.output!;

  if (!existsSync(planPath)) throw new Error(`Plan file not found: ${planPath}`);
  if (!existsSync(rawVideo)) throw new Error(`Video file not found: ${rawVideo}`);

  console.log(`\n═══ Phase 3: Assembly ═══`);

  const plan: Plan = JSON.parse(await readFile(planPath, "utf-8"));
  console.log(`  📋 Plan: ${plan.title || "Untitled"} (${plan.scenes.length} scenes, ${plan.steps.length} steps)`);
  console.log(`  🎥 Raw: ${rawVideo}`);

  const result = await assembleVideo(plan, rawVideo, dirname(outputPath));

  console.log(`\n✅ Assembly complete!`);
  console.log(`   📹 ${result.finalVideo}`);
  const durCheck = spawnSync("ffprobe", [
    "-v", "quiet", "-show_entries", "format=duration",
    "-of", "default=noprint_wrappers=1:nokey=1", result.finalVideo,
  ], { stdio: "pipe" });
  console.log(`   ⏱️  ${parseFloat(durCheck.stdout.toString().trim() || "0").toFixed(1)}s`);
  console.log(`   📝 ${result.subtitleFile}`);
}

if (import.meta.path === Bun.main) {
  main().catch(e => {
    console.error(`\n❌ ${e.message}`);
    process.exit(1);
  });
}

function fmtSrt(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  const ms = Math.floor((sec % 1) * 1000);
  return `${pad(h)}:${pad(m)}:${pad(s)},${String(ms).padStart(3, "0")}`;
}

function pad(n: number): string { return String(n).padStart(2, "0"); }
