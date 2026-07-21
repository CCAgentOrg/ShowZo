/**
 * ShowZo API Server — Hono
 *
 * Routes:
 *   POST /api/plan  — generates an action plan from URL + scenario
 *   GET  /api/health — health check
 *
 * During dev this runs on :3001 and Vite proxies /api to it.
 * In production, served as part of the deployed Zo Site.
 */

import { Hono } from "hono";
import { cors } from "hono/cors";

const app = new Hono();

app.use("*", cors());

// ── Health ─────────────────────────────────────────────────────────────

app.get("/api/health", (c) => c.json({ ok: true, uptime: process.uptime() }));

// ── Plan generation ────────────────────────────────────────────────────

app.post("/api/plan", async (c) => {
  try {
    const body = await c.req.json();
    const { url, scenario } = body || {};

    // Validate inputs
    if (!url || typeof url !== "string" || !url.trim()) {
      return c.json({ error: "Missing required field: url" }, 400);
    }
    if (!scenario || typeof scenario !== "string" || !scenario.trim()) {
      return c.json({ error: "Missing required field: scenario" }, 400);
    }

    const cleanUrl = url.trim();
    const cleanScenario = scenario.trim();

    try {
      new URL(cleanUrl);
    } catch {
      return c.json({ error: "Invalid URL format" }, 400);
    }

    if (cleanScenario.length < 10) {
      return c.json({ error: "Scenario must be at least 10 characters" }, 400);
    }

    // Forward to the pipeline planner
    const { generatePlan } = await import("../pipeline/plan");
    const plan = await generatePlan(cleanUrl, cleanScenario);

    return c.json({
      title: plan.title,
      url: plan.url,
      steps: plan.steps.map((s) => ({
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
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Internal server error";
    console.error("POST /api/plan error:", message);
    return c.json({ error: message }, 500);
  }
});

export default app;
