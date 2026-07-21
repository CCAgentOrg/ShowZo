import { serveStatic } from "hono/bun";
import type { ViteDevServer } from "vite";
import { createServer as createViteServer } from "vite";
import config from "./zosite.json";
import { Hono } from "hono";
import { $ } from "bun";
import { unlinkSync, existsSync, mkdirSync, cpSync, rmSync, readdirSync, readFileSync } from "fs";
import { join } from "path";

// ── Config ────────────────────────────────────────────────────────────────
const SESSIONS_DIR = "/tmp/showzo-sessions";
const MODEL = "byok:b5700bd6-fca9-4aa2-9d31-bc9f5bb33bbc";
const ZO_ASK_URL = "https://api.zo.computer/zo/ask";
const ASSETS_DIR = "/tmp/showzo-assets";
const MAX_SESSIONS = 20;
const SESSION_TTL_MS = 2 * 60 * 60 * 1_000; // 2 hours

type Mode = "development" | "production";
const app = new Hono();
const mode: Mode = process.env.NODE_ENV === "production" ? "production" : "development";

// ── Session helpers ────────────────────────────────────────────────────────
interface ShowZoSession {
  id: string;
  url: string;
  scenario: string;
  status: "queued" | "planning" | "recording" | "assembling" | "complete" | "failed";
  currentStep: number;
  totalSteps: number;
  steps: StepState[];
  elapsedMs: number;
  createdAt: number;
  completedAt?: number;
  error?: string;
  log: string[];
  outputVideo?: string;
  screenshotCount: number;
}

interface StepState {
  id: string;
  order: number;
  action: string;
  target?: string;
  value?: string;
  narration: string;
  status: "pending" | "running" | "done" | "error";
  error?: string;
  screenshot?: string;
}

const sessions = new Map<string, ShowZoSession>();

function addLog(sessionId: string, msg: string) {
  const s = sessions.get(sessionId);
  if (!s) return;
  const ts = new Date().toISOString().slice(11, 23);
  s.log.push(`[${ts}] ${msg}`);
}

function getSessionDir(sessionId: string) {
  return join(SESSIONS_DIR, sessionId);
}

function saveSessionState(sessionId: string) {
  try {
    const dir = getSessionDir(sessionId);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    const s = sessions.get(sessionId);
    if (s) {
      Bun.write(join(dir, "status.json"), JSON.stringify(s, null, 2));
    }
  } catch {}
}

function loadSessionState(sessionId: string): ShowZoSession | undefined {
  try {
    const p = join(getSessionDir(sessionId), "status.json");
    if (existsSync(p)) {
      const data = readFileSync(p, "utf-8");
      return JSON.parse(data);
    }
  } catch {}
  return undefined;
}

function getOrCreateSession(sessionId: string, initial?: Partial<ShowZoSession>): ShowZoSession {
  let s = sessions.get(sessionId);
  if (!s) {
    s = loadSessionState(sessionId);
  }
  if (!s && initial) {
    s = {
      id: sessionId,
      url: initial.url || "",
      scenario: initial.scenario || "",
      status: "queued",
      currentStep: 0,
      totalSteps: 0,
      steps: [],
      elapsedMs: 0,
      createdAt: Date.now(),
      log: [],
      screenshotCount: 0,
    };
    sessions.set(sessionId, s);
    saveSessionState(sessionId);
  }
  return s!;
}

// ── Timeout helper ─────────────────────────────────────────────────────────
async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: Timer;
  const timeout = new Promise<T>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`Timed out after ${ms}ms`)), ms);
  });
  const result = await Promise.race([promise, timeout]);
  clearTimeout(timer!);
  return result;
}

// ── Recording Pipeline ─────────────────────────────────────────────────────
async function runPipeline(sessionId: string, plan: any) {
  const s = getOrCreateSession(sessionId);
  s.status = "recording";
  s.totalSteps = plan.steps?.length || 0;
  s.steps = (plan.steps || []).map((step: any) => ({
    id: step.id,
    order: step.order,
    action: step.action,
    target: step.target,
    value: step.value,
    narration: step.narration || "",
    status: "pending",
  }));
  saveSessionState(sessionId);

  const dir = getSessionDir(sessionId);
  const shotsDir = join(dir, "screenshots");
  const audioDir = join(dir, "audio");
  mkdirSync(shotsDir, { recursive: true });
  mkdirSync(audioDir, { recursive: true });

  try {
    // Navigate to target site
    const targetUrl = plan.url;
    addLog(sessionId, `Navigating to ${targetUrl}`);
    await $`agent-browser open ${targetUrl}`.quiet();

    // Execute each step
    for (let i = 0; i < plan.steps.length; i++) {
      const step = plan.steps[i];
      s.currentStep = i;
      s.steps[i].status = "running";
      saveSessionState(sessionId);

      addLog(sessionId, `Step ${i + 1}/${plan.steps.length}: ${step.action} ${step.target || ""}`);

      try {
        switch (step.action) {
          case "navigate":
            await withTimeout($`agent-browser open ${step.target || plan.url}`.quiet(), 30_000);
            break;
          case "click":
            await withTimeout($`agent-browser click ${step.target || ""}`.quiet(), 15_000);
            break;
          case "type":
            await withTimeout($`agent-browser type ${step.target || ""} ${step.value || ""}`.quiet(), 15_000);
            break;
          case "fill":
            await withTimeout($`agent-browser fill ${step.target || ""} ${step.value || ""}`.quiet(), 15_000);
            break;
          case "scroll":
            await withTimeout($`agent-browser scroll down ${step.value || "500"}`.quiet(), 10_000);
            break;
          case "wait":
            await withTimeout($`agent-browser wait ${step.value || "2000"}`.quiet(), 30_000);
            break;
          case "press":
            await withTimeout($`agent-browser press ${step.value || "Enter"}`.quiet(), 10_000);
            break;
          case "hover":
            await withTimeout($`agent-browser hover ${step.target || ""}`.quiet(), 10_000);
            break;
          case "screenshot":
            // Screenshot is always taken below
            break;
          default:
            addLog(sessionId, `Unknown action: ${step.action}, skipping`);
        }

        // Always take a screenshot after the action
        const shotFile = join(shotsDir, `step_${String(i + 1).padStart(3, "0")}.png`);
        await withTimeout($`agent-browser screenshot ${shotFile}`.quiet(), 30_000);
        s.screenshotCount++;
        s.steps[i].screenshot = shotFile;
        s.steps[i].status = "done";

      } catch (err: any) {
        addLog(sessionId, `Step ${i + 1} error: ${err.message}`);
        s.steps[i].status = "error";
        s.steps[i].error = err.message;

        // Try to get a screenshot even on error
        try {
          const shotFile = join(shotsDir, `step_${String(i + 1).padStart(3, "0")}_error.png`);
          await withTimeout($`agent-browser screenshot ${shotFile}`.quiet(), 10_000);
        } catch {}
      }
      saveSessionState(sessionId);
    }

    // Generate narration audio for each step
    addLog(sessionId, "Generating narration audio");
    s.status = "assembling";
    saveSessionState(sessionId);

    for (let i = 0; i < plan.steps.length; i++) {
      const step = plan.steps[i];
      const narration = step.narration || `Step ${step.order}: ${step.action}`;
      const audioFile = join(audioDir, `step_${String(i + 1).padStart(3, "0")}.mp3`);
      try {
        await withTimeout($`edge-tts --voice en-US-JennyNeural --text ${narration} --write-media ${audioFile}`.quiet(), 30_000);
      } catch (err: any) {
        addLog(sessionId, `TTS error for step ${i + 1}: ${err.message}`);
        // Create a silent audio file as fallback
        await withTimeout($`ffmpeg -f lavfi -i anullsrc=r=44100:cl=mono -t 3 -q:a 9 -acodec libmp3lame ${audioFile}`.quiet(), 10_000);
      }
    }

    // Assemble final video
    addLog(sessionId, "Assembling final video");
    const finalVideo = join(dir, "showzo_output.mp4");
    await assembleVideo(shotsDir, audioDir, plan.steps, finalVideo, sessionId);

    s.outputVideo = finalVideo;
    s.status = "complete";
    s.completedAt = Date.now();
    addLog(sessionId, "Pipeline complete!");
    saveSessionState(sessionId);

  } catch (err: any) {
    s.status = "failed";
    s.error = err.message;
    addLog(sessionId, `Pipeline failed: ${err.message}`);
    saveSessionState(sessionId);
  }
}

/**
 * Assemble screenshots + audio into final video using ffmpeg.
 */
async function assembleVideo(
  shotsDir: string,
  audioDir: string,
  steps: any[],
  outputPath: string,
  sessionId: string,
) {
  const files = readdirSync(shotsDir)
    .filter(f => f.endsWith(".png"))
    .sort();

  if (files.length === 0) {
    addLog(sessionId, "No screenshots to assemble");
    return;
  }

  const listFile = join(shotsDir, "..", "concat.txt");
  const lines: string[] = [];

  for (let i = 0; i < files.length; i++) {
    const img = join(shotsDir, files[i]);
    const audioFile = join(audioDir, files[i].replace(/\.png$/, ".mp3"));
    const audioDuration = existsSync(audioFile) ? await getAudioDuration(audioFile) : 3;
    const duration = Math.max(audioDuration, 3);

    // ffmpeg concat demuxer format: file path + duration
    lines.push(`file '${img}'`);
    lines.push(`duration ${duration}`);
  }

  // Write concat file
  await Bun.write(listFile, lines.join("\n"));

  // Build complex filter: crossfade between images
  // For simplicity, use concat demuxer with audio mixing
  const audioFiles = files.map(f =>
    join(audioDir, f.replace(/\.png$/, ".mp3"))
  ).filter(f => existsSync(f));

  if (audioFiles.length > 0) {
    // Build amix filter for audio
    const audioInputs = audioFiles.map((f, i) => `-i ${f}`).join(" ");
    const amixInputs = audioFiles.map((_, i) => `[${i + 1}:a]`).join("");
    const amixWeights = audioFiles.map(() => "1").join(" ");

    await withTimeout($`ffmpeg -y -f concat -safe 0 -i ${listFile} ${audioInputs} \
      -filter_complex "${amixInputs}amix=inputs=${audioFiles.length}:duration=first:dropout_transition=2,volume=2.0[a]" \
      -map 0:v -map "[a]" -c:v libx264 -preset fast -crf 23 -pix_fmt yuv420p \
      -c:a aac -b:a 128k -shortest \
      ${outputPath}`.quiet(), 120_000);
  } else {
    await withTimeout($`ffmpeg -y -f concat -safe 0 -i ${listFile} \
      -c:v libx264 -preset fast -crf 23 -pix_fmt yuv420p \
      ${outputPath}`.quiet(), 60_000);
  }

  addLog(sessionId, `Final video: ${outputPath}`);
}

async function getAudioDuration(filePath: string): Promise<number> {
  try {
    const result = await $`ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 ${filePath}`.quiet().text();
    return Math.max(parseFloat(result.trim()) || 3, 3);
  } catch {
    return 3;
  }
}

// ── Cleanup ────────────────────────────────────────────────────────────────
function cleanupSessions() {
  const now = Date.now();
  for (const [id, s] of sessions) {
    if (now - s.createdAt > SESSION_TTL_MS) {
      sessions.delete(id);
      try { rmSync(getSessionDir(id), { recursive: true, force: true }); } catch {}
    }
  }
}

// Run cleanup every 30 min
setInterval(cleanupSessions, 30 * 60 * 1_000);

// ── API Routes ─────────────────────────────────────────────────────────────
app.get("/api/health", (c) => c.json({ ok: true, uptime: process.uptime() }));

app.post("/api/plan", async (c) => {
  try {
    const body = await c.req.json();
    const { url, scenario } = body || {};

    if (!url || typeof url !== "string" || !url.trim()) {
      return c.json({ error: "Missing required field: url" }, 400);
    }
    if (!scenario || typeof scenario !== "string" || !scenario.trim()) {
      return c.json({ error: "Missing required field: scenario" }, 400);
    }

    const cleanUrl = url.trim();
    const cleanScenario = scenario.trim();

    try { new URL(cleanUrl); } catch {
      return c.json({ error: "Invalid URL format" }, 400);
    }

    if (cleanScenario.length < 10) {
      return c.json({ error: "Scenario must be at least 10 characters" }, 400);
    }

    // Call the AI plan generator
    try {
      const { generatePlan } = await import("/home/workspace/showzo/src/showzo/api/plan.mjs");
      const plan = await generatePlan(cleanUrl, cleanScenario);
      return c.json({
        title: plan.title,
        url: plan.url,
        steps: plan.steps.map((s: any) => ({
          id: s.id,
          order: s.order,
          action: s.action,
          target: s.target,
          value: s.value,
          narration: s.narration,
        })),
        metadata: plan.metadata
          ? { estimatedDuration: plan.metadata.estimatedDuration }
          : undefined,
      });
    } catch (llmErr: any) {
      // Fallback: structured mock plan
      console.error("LLM plan generation failed, using fallback:", llmErr.message);
      return c.json({
        title: `Walkthrough of ${cleanUrl}`,
        url: cleanUrl,
        steps: [
          { id: "1", order: 1, action: "navigate", target: cleanUrl, narration: `Let's start by navigating to ${cleanUrl}.` },
          { id: "2", order: 2, action: "wait", value: "3000", narration: "Waiting for the page to fully load." },
          { id: "3", order: 3, action: "scroll", value: "500", narration: "Scrolling down to see more content." },
          { id: "4", order: 4, action: "screenshot", narration: "Taking a screenshot of the page." },
        ],
        metadata: { estimatedDuration: 20 },
      });
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Internal server error";
    console.error("POST /api/plan error:", message);
    return c.json({ error: message }, 500);
  }
});

app.post("/api/record", async (c) => {
  try {
    const body = await c.req.json();
    const { plan, url, scenario } = body || {};

    const sessionId = `showzo_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const targetUrl = plan?.url || url || "";
    const targetScenario = scenario || plan?.title || "";

    // Limit concurrent sessions
    if (sessions.size >= MAX_SESSIONS) {
      return c.json({ error: "Too many active sessions. Try again later." }, 429);
    }

    // Create session entry
    const session: ShowZoSession = {
      id: sessionId,
      url: targetUrl,
      scenario: targetScenario,
      status: "queued",
      currentStep: 0,
      totalSteps: plan?.steps?.length || 0,
      steps: (plan?.steps || []).map((s: any) => ({
        id: s.id,
        order: s.order,
        action: s.action,
        target: s.target,
        value: s.value,
        narration: s.narration || "",
        status: "pending",
      })),
      elapsedMs: 0,
      createdAt: Date.now(),
      log: [],
      screenshotCount: 0,
    };

    sessions.set(sessionId, session);
    saveSessionState(sessionId);

    // Spawn pipeline in background (fire-and-forget)
    runPipeline(sessionId, plan || { url: targetUrl, steps: [] }).catch((err) => {
      console.error(`Pipeline ${sessionId} crashed:`, err);
      const s = sessions.get(sessionId);
      if (s) {
        s.status = "failed";
        s.error = err.message;
        saveSessionState(sessionId);
      }
    });

    return c.json({ sessionId });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Internal server error";
    return c.json({ error: message }, 500);
  }
});

app.get("/api/session/:id", async (c) => {
  const id = c.req.param("id");
  let session = sessions.get(id);
  if (!session) {
    session = loadSessionState(id);
    if (!session) return c.json({ error: "Session not found" }, 404);
    sessions.set(id, session);
  }

  // Calculate elapsed time
  const elapsed = session.completedAt
    ? session.completedAt - session.createdAt
    : Date.now() - session.createdAt;

  return c.json({
    id: session.id,
    url: session.url,
    status: session.status,
    currentStep: session.currentStep,
    totalSteps: session.totalSteps,
    steps: session.steps,
    elapsedMs: elapsed,
    createdAt: session.createdAt,
    completedAt: session.completedAt,
    error: session.error,
    log: session.log.slice(-50), // Last 50 log entries
    screenshotCount: session.screenshotCount,
    hasVideo: !!session.outputVideo && existsSync(session.outputVideo),
  });
});

app.get("/api/session/:id/video", async (c) => {
  const id = c.req.param("id");
  const session = sessions.get(id) || loadSessionState(id);
  if (!session?.outputVideo || !existsSync(session.outputVideo)) {
    return c.json({ error: "Video not available" }, 404);
  }

  const file = Bun.file(session.outputVideo);
  const stat = await file.stat();
  return new Response(file, {
    headers: {
      "Content-Type": "video/mp4",
      "Content-Length": String(stat.size),
      "Content-Disposition": `attachment; filename="showzo-${id.slice(0, 12)}.mp4"`,
      "Accept-Ranges": "bytes",
    },
  });
});

app.get("/api/session/:id/screenshots/:filename", async (c) => {
  const id = c.req.param("id");
  const filename = c.req.param("filename");
  const filePath = join(SESSIONS_DIR, id, "screenshots", filename);
  if (!existsSync(filePath)) {
    return c.json({ error: "File not found" }, 404);
  }
  const file = Bun.file(filePath);
  const ext = filename.split(".").pop()?.toLowerCase();
  const mime = ext === "png" ? "image/png" : ext === "jpg" || ext === "jpeg" ? "image/jpeg" : "application/octet-stream";
  return new Response(file, {
    headers: { "Content-Type": mime, "Cache-Control": "public, max-age=3600" },
  });
});

app.get("/api/sessions", (c) => {
  const list = Array.from(sessions.values()).map(s => ({
    id: s.id,
    url: s.url,
    status: s.status,
    currentStep: s.currentStep,
    totalSteps: s.totalSteps,
    elapsedMs: Date.now() - s.createdAt,
    createdAt: s.createdAt,
    hasVideo: !!s.outputVideo && existsSync(s.outputVideo),
  }));
  return c.json({ sessions: list, count: list.length });
});

// ── Original routes ────────────────────────────────────────────────────────

app.get("/api/hello-zo", (c) => c.json({ msg: "Hello from Zo" }));

if (mode === "production") {
  configureProduction(app);
} else {
  await configureDevelopment(app);
}

const port = process.env.PORT
  ? parseInt(process.env.PORT, 10)
  : mode === "production"
    ? (config.publish?.published_port ?? config.local_port)
    : config.local_port;

export default { fetch: app.fetch, port, idleTimeout: 255 };

function configureProduction(app: Hono) {
  app.use("/assets/*", serveStatic({ root: "./dist" }));
  app.get("/favicon.ico", (c) => c.redirect("/favicon.svg", 302));
  app.use(async (c, next) => {
    if (c.req.method !== "GET") return next();
    const path = c.req.path;
    if (path.startsWith("/api/") || path.startsWith("/assets/")) return next();
    const file = Bun.file(`./dist${path}`);
    if (await file.exists()) {
      const stat = await file.stat();
      if (stat && !stat.isDirectory()) {
        return new Response(file);
      }
    }
    return serveStatic({ path: "./dist/index.html" })(c, next);
  });
}

async function configureDevelopment(app: Hono): Promise<ViteDevServer> {
  const vite = await createViteServer({
    server: { middlewareMode: true, hmr: false, ws: false },
    appType: "custom",
  });

  app.use("*", async (c, next) => {
    if (c.req.path.startsWith("/api/")) return next();
    if (c.req.path === "/favicon.ico") return c.redirect("/favicon.svg", 302);

    const url = c.req.path;
    try {
      if (url === "/" || url === "/index.html") {
        let template = await Bun.file("./index.html").text();
        template = await vite.transformIndexHtml(url, template);
        return c.html(template, {
          headers: { "Cache-Control": "no-store, must-revalidate" },
        });
      }

      const publicFile = Bun.file(`./public${url}`);
      if (await publicFile.exists() && !(await publicFile.stat()).isDirectory()) {
        return new Response(publicFile, {
          headers: { "Cache-Control": "no-store, must-revalidate" },
        });
      }

      try {
        const result = await vite.transformRequest(url);
        if (result) {
          return new Response(result.code, {
            headers: { "Content-Type": "application/javascript", "Cache-Control": "no-store, must-revalidate" },
          });
        }
      } catch {}

      let template = await Bun.file("./index.html").text();
      template = await vite.transformIndexHtml("/", template);
      return c.html(template, {
        headers: { "Cache-Control": "no-store, must-revalidate" },
      });
    } catch (error) {
      vite.ssrFixStacktrace(error as Error);
      console.error(error);
      return c.text("Internal Server Error", 500);
    }
  });

  return vite;
}