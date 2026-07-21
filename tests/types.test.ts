/**
 * types.test.ts — Schema and structure validation for ShowZo data types
 *
 * Tests the verifiability layer: validatePlan, hashPlan, and type-level checks.
 * No external dependencies. Pure logic only.
 */

import { describe, test, expect } from "bun:test";
import { validatePlan, hashPlan } from "./verify";

// ── Helpers ────────────────────────────────────────────────────────────────

function validPlan() {
  return {
    title: "Demo Walkthrough",
    url: "https://example.com",
    steps: [
      { id: "step-1", order: 1, action: "navigate", narration: "Start here", expected: "Page loads" },
      { id: "step-2", order: 2, action: "click", target: "#signup", narration: "Click signup", expected: "Form opens" },
      { id: "step-3", order: 3, action: "type", target: "#email", value: "test@example.com", narration: "Enter email" },
    ],
    scenes: [
      { order: 1, title: "Intro", narration: "Welcome to this demo.", duration: 15, zoomTarget: { x: 0.5, y: 0.3, scale: 1.0 }, stepRange: [1, 2] },
      { order: 2, title: "Signup", narration: "Now let's fill in the form.", duration: 20, zoomTarget: { x: 0.3, y: 0.5, scale: 1.5 }, stepRange: [3, 3] },
    ],
    metadata: { pageTitle: "Example", estimatedDuration: 35 },
  };
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe("validatePlan", () => {
  test("accepts a valid plan", () => {
    const errors = validatePlan(validPlan());
    expect(errors).toEqual([]);
  });

  test("rejects non-object", () => {
    expect(validatePlan(null)).not.toEqual([]);
    expect(validatePlan("string")).not.toEqual([]);
    expect(validatePlan(42)).not.toEqual([]);
  });

  test("rejects plan without steps", () => {
    const p = validPlan();
    delete (p as any).steps;
    expect(validatePlan(p).some(e => e.path === "steps")).toBe(true);
  });

  test("rejects empty steps array", () => {
    const p = validPlan();
    p.steps = [];
    expect(validatePlan(p).some(e => e.path === "steps")).toBe(true);
  });

  test("rejects step without id", () => {
    const p = validPlan();
    delete (p.steps[0] as any).id;
    const errors = validatePlan(p);
    expect(errors.some(e => e.path === "steps[0].id")).toBe(true);
  });

  test("rejects step without order", () => {
    const p = validPlan();
    delete (p.steps[1] as any).order;
    const errors = validatePlan(p);
    expect(errors.some(e => e.path.startsWith("steps[1]") && e.message.includes("order"))).toBe(true);
  });

  test("rejects plan without scenes", () => {
    const p = validPlan();
    p.scenes = [] as any;
    expect(validatePlan(p).some(e => e.message.includes("at least one scene"))).toBe(true);
  });

  test("rejects scene without title", () => {
    const p = validPlan();
    delete (p.scenes[0] as any).title;
    const errors = validatePlan(p);
    expect(errors.some(e => e.path === "scenes[0].title")).toBe(true);
  });

  test("rejects scene with negative duration", () => {
    const p = validPlan();
    p.scenes[0].duration = 0;
    const errors = validatePlan(p);
    expect(errors.some(e => e.path === "scenes[0].duration")).toBe(true);
  });

  test("rejects zoomTarget x outside 0-1", () => {
    const p = validPlan();
    p.scenes[0].zoomTarget!.x = 1.5;
    const errors = validatePlan(p);
    expect(errors.some(e => e.path === "scenes[0].zoomTarget.x")).toBe(true);
  });

  test("rejects zoomTarget scale < 1", () => {
    const p = validPlan();
    p.scenes[0].zoomTarget!.scale = 0.5;
    const errors = validatePlan(p);
    expect(errors.some(e => e.path === "scenes[0].zoomTarget.scale")).toBe(true);
  });

  test("rejects scene order mismatch (must be sequential 1,2,3...)", () => {
    const p = validPlan();
    p.scenes[1].order = 3; // gap: 1 then 3
    const errors = validatePlan(p);
    expect(errors.some(e => e.path === "scenes")).toBe(true);
  });

  test("rejects stepRange exceeding step count", () => {
    const p = validPlan();
    p.scenes[1].stepRange = [3, 5];
    const errors = validatePlan(p);
    expect(errors.some(e => e.path === "scenes[1].stepRange[1]")).toBe(true);
  });

  test("rejects stepRange start < end", () => {
    const p = validPlan();
    p.scenes[0].stepRange = [2, 1];
    const errors = validatePlan(p);
    expect(errors.some(e => e.message.includes("End must be >= start"))).toBe(true);
  });

  test("rejects plan without url", () => {
    const p = validPlan();
    delete (p as any).url;
    const errors = validatePlan(p);
    expect(errors.some(e => e.path === "url")).toBe(true);
  });
});

// ── Hash Tests ────────────────────────────────────────────────────────────

describe("hashPlan", () => {
  test("produces deterministic hash for same plan", () => {
    const a = hashPlan(validPlan());
    const b = hashPlan(validPlan());
    expect(a).toBe(b);
    expect(a.length).toBe(16); // We truncate to 16 hex chars
  });

  test("produces different hash for different plans", () => {
    const a = hashPlan(validPlan());
    const b = validPlan();
    b.title = "Different Title";
    const hb = hashPlan(b);
    expect(a).not.toBe(hb);
  });

  test("hash changes when steps change", () => {
    const a = hashPlan(validPlan());
    const b = validPlan();
    b.steps.push({ id: "step-4", order: 4, action: "wait", narration: "Pause" });
    const hb = hashPlan(b);
    expect(a).not.toBe(hb);
  });
});
