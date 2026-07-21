#!/usr/bin/env bun
/**
 * verify.ts — Verifiability toolkit for ShowZo
 *
 * Pure functions to validate, hash, and verify pipeline artifacts.
 * Every pipeline phase should call the appropriate verify function
 * on its output before proceeding to the next phase.
 *
 * Usage (CLI):
 *   bun run tests/verify.ts plan plan.json
 *   bun run tests/verify.ts video output.mp4
 */

import { createHash } from "node:crypto";
import { existsSync, statSync } from "node:fs";
import { execSync } from "node:child_process";

// ── Plan Verification ──────────────────────────────────────────────────────

export interface ValidationError {
  path: string;
  message: string;
}

/**
 * Validate an ActionPlan structure.
 * Returns empty array if valid, or list of errors.
 */
export function validatePlan(plan: unknown): ValidationError[] {
  const errors: ValidationError[] = [];

  if (!plan || typeof plan !== "object") {
    return [{ path: "(root)", message: "Plan must be a non-null object" }];
  }

  const p = plan as Record<string, unknown>;

  if (!Array.isArray(p.steps)) {
    errors.push({ path: "steps", message: "Must be a non-empty array" });
  } else if (p.steps.length === 0) {
    errors.push({ path: "steps", message: "Must have at least one step" });
  } else {
    for (let i = 0; i < p.steps.length; i++) {
      const s = p.steps[i] as Record<string, unknown>;
      const stepPath = `steps[${i}]`;

      if (typeof s.id !== "string" || !s.id) {
        errors.push({ path: `${stepPath}.id`, message: "Must be a non-empty string" });
      }
      if (typeof s.order !== "number" || s.order < 1) {
        errors.push({ path: `${stepPath}.order`, message: "order must be a positive integer" });
      }
      if (typeof s.action !== "string") {
        errors.push({ path: `${stepPath}.action`, message: "Must be a string" });
      }
      // action value check handled separately
    }
  }

  if (!Array.isArray(p.scenes)) {
    errors.push({ path: "scenes", message: "Must be a non-empty array" });
  } else if (p.scenes.length === 0) {
    errors.push({ path: "scenes", message: "Must have at least one scene" });
  } else {
    for (let i = 0; i < p.scenes.length; i++) {
      const s = p.scenes[i] as Record<string, unknown>;
      const scenePath = `scenes[${i}]`;

      if (typeof s.order !== "number" || s.order < 1) {
        errors.push({ path: `${scenePath}.order`, message: "order must be a positive integer" });
      }
      if (typeof s.title !== "string" || !s.title) {
        errors.push({ path: `${scenePath}.title`, message: "Must be a non-empty string" });
      }
      if (typeof s.duration !== "number" || s.duration < 1) {
        errors.push({ path: `${scenePath}.duration`, message: "Must be >= 1 second" });
      }
      if (s.zoomTarget !== undefined) {
        const zt = s.zoomTarget as Record<string, unknown>;
        if (typeof zt.x !== "number" || zt.x < 0 || zt.x > 1) {
          errors.push({ path: `${scenePath}.zoomTarget.x`, message: "Must be a number 0-1" });
        }
        if (typeof zt.y !== "number" || zt.y < 0 || zt.y > 1) {
          errors.push({ path: `${scenePath}.zoomTarget.y`, message: "Must be a number 0-1" });
        }
        if (typeof zt.scale !== "number" || zt.scale < 1) {
          errors.push({ path: `${scenePath}.zoomTarget.scale`, message: "Must be >= 1.0" });
        }
      }
    }
  }

  // Scene step ranges must map to valid steps
  for (let i = 0; i < (p.scenes as Record<string, unknown>[]).length; i++) {
    const s = p.scenes[i] as Record<string, unknown>;
    if (s.stepRange) {
      const range = s.stepRange as [number, number];
      if (!Array.isArray(range) || range.length !== 2) {
        errors.push({ path: `scenes[${i}].stepRange`, message: "Must be [start, end]" });
      } else {
        if (range[0] < 1) errors.push({ path: `scenes[${i}].stepRange[0]`, message: "Must be >= 1" });
        if (range[1] < range[0]) errors.push({ path: `scenes[${i}].stepRange`, message: "End must be >= start" });
        const stepCount = (p.steps as Array<unknown>)?.length || 0;
        if (stepCount > 0 && range[1] > stepCount) {
          errors.push({ path: `scenes[${i}].stepRange[1]`, message: "Exceeds step count" });
        }
      }
    }
  }

  if (!p.url || typeof p.url !== "string") {
    errors.push({ path: "url", message: "Must be a non-empty URL string" });
  }

  // Scene order must be sequential starting from 1
  const sceneOrders = (p.scenes as Record<string, unknown>[] || []).map(s => s.order as number).sort((a, b) => a - b);
  for (let i = 0; i < sceneOrders.length; i++) {
    if (sceneOrders[i] !== i + 1) {
      errors.push({ path: "scenes", message: `Expected scene order ${i + 1}, got ${sceneOrders[i]}` });
      break;
    }
  }

  return errors;
}

/**
 * Compute a content hash for a plan.
 * Deterministic: same plan always produces same hash.
 */
export function hashPlan(plan: unknown): string {
  const normalized = JSON.stringify(plan, Object.keys(plan as object).sort());
  return createHash("sha256").update(normalized).digest("hex").slice(0, 16);
}

/**
 * Verify a plan file on disk.
 * Returns { valid, hash, errors }.
 */
export function verifyPlanFile(path: string): { valid: boolean; hash: string; errors: ValidationError[] } {
  if (!existsSync(path)) {
    return { valid: false, hash: "", errors: [{ path: "(file)", message: `File not found: ${path}` }] };
  }
  const content = Bun.file(path);
  // Read the file as text and parse
  // We'll re-read it properly
  try {
    const raw = require("fs").readFileSync(path, "utf-8");
    const plan = JSON.parse(raw);
    const errors = validatePlan(plan);
    return {
      valid: errors.length === 0,
      hash: errors.length === 0 ? hashPlan(plan) : "",
      errors,
    };
  } catch (e) {
    return {
      valid: false,
      hash: "",
      errors: [{ path: "(root)", message: `Parse error: ${(e as Error).message}` }],
    };
  }
}

// ── Video Verification ─────────────────────────────────────────────────────

export interface VideoInfo {
  valid: boolean;
  path: string;
  duration?: number;
  width?: number;
  height?: number;
  sizeBytes?: number;
  hasAudio?: boolean;
  codec?: string;
  error?: string;
}

/**
 * Probe a video file to verify it's a valid, playable MP4.
 */
export function verifyVideo(path: string): VideoInfo {
  if (!existsSync(path)) {
    return { valid: false, path, error: "File not found" };
  }

  try {
    const output = execSync(
      `ffprobe -v quiet -print_format json -show_format -show_streams "${path}" 2>&1`,
      { encoding: "utf-8", timeout: 10_000 }
    );
    const info = JSON.parse(output);
    const videoStream = info.streams?.find((s: Record<string, unknown>) => s.codec_type === "video");
    const audioStream = info.streams?.find((s: Record<string, unknown>) => s.codec_type === "audio");

    return {
      valid: true,
      path,
      duration: parseFloat(info.format?.duration || "0"),
      width: videoStream?.width as number,
      height: videoStream?.height as number,
      sizeBytes: parseInt(info.format?.size || "0"),
      hasAudio: !!audioStream,
      codec: videoStream?.codec_name as string,
    };
  } catch (e) {
    return { valid: false, path, error: (e as Error).message };
  }
}

// ── Session Verifiability ──────────────────────────────────────────────────

export interface SessionVerification {
  id: string;
  status: string;
  planValid: boolean;
  recordingExists: boolean;
  outputExists: boolean;
  outputValid: boolean;
  duration?: number;
  errors: string[];
}

/**
 * Verify a completed session by checking all artifacts.
 */
export function verifySession(session: {
  id: string;
  status: string;
  plan?: unknown;
  rawVideo?: string;
  finalVideo?: string;
  subtitleFile?: string;
}): SessionVerification {
  const errors: string[] = [];
  const planValid = session.plan ? validatePlan(session.plan).length === 0 : false;
  if (!planValid) errors.push("Plan validation failed");

  const recordingExists = !!session.rawVideo && existsSync(session.rawVideo);
  if (!recordingExists) errors.push("Raw recording not found");

  const outputExists = !!session.finalVideo && existsSync(session.finalVideo);
  let outputValid = false;
  let duration: number | undefined;

  if (outputExists) {
    const v = verifyVideo(session.finalVideo!);
    outputValid = v.valid;
    duration = v.duration;
    if (!v.valid) errors.push(`Output video invalid: ${v.error}`);
  } else {
    errors.push("Output video not found");
  }

  if (session.subtitleFile && !existsSync(session.subtitleFile)) {
    errors.push("Subtitle file not found");
  }

  return {
    id: session.id,
    status: errors.length === 0 ? "complete" : "failed",
    planValid,
    recordingExists,
    outputExists,
    outputValid,
    duration,
    errors,
  };
}

// ── CLI entry point ────────────────────────────────────────────────────────
if (import.meta.path === Bun.main) {
  const [command, ...args] = Bun.argv.slice(2);

  switch (command) {
    case "plan": {
      const [path] = args;
      if (!path) { console.error("Usage: verify.ts plan <plan.json>"); process.exit(1); }
      const result = verifyPlanFile(path);
      console.log(JSON.stringify(result, null, 2));
      process.exit(result.valid ? 0 : 1);
    }
    case "video": {
      const [path] = args;
      if (!path) { console.error("Usage: verify.ts video <video.mp4>"); process.exit(1); }
      const result = verifyVideo(path);
      console.log(JSON.stringify(result, null, 2));
      process.exit(result.valid ? 0 : 1);
    }
    default:
      console.error(`Usage: verify.ts <plan|video> <path>`);
      process.exit(1);
  }
}
