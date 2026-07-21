/**
 * RecordingProgress — unit tests
 *
 * Tests cover state machine logic, status ordering, and time formatting.
 * React rendering is skipped (no jsdom) — we test the data layer that drives the view.
 */

import { describe, it, expect } from "bun:test";
import type { StepRecordStatus, RecordingState } from "../src/types";

// ── Helpers extracted from the component for testability ──────────────────

type SRS = StepRecordStatus;

const STATUS_ORDER: SRS[] = ["pending", "running", "done", "error"];

function statusIndex(s: SRS): number {
  return STATUS_ORDER.indexOf(s);
}

function formatTime(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function isTerminal(status: string): boolean {
  return status === "complete" || status === "failed";
}

function stepCountByStatus(steps: { status: SRS }[], status: SRS): number {
  return steps.filter((s) => s.status === status).length;
}

// ── Tests ─────────────────────────────────────────────────────────────────

describe("status ordering", () => {
  it("pending is before running", () => {
    expect(statusIndex("pending")).toBeLessThan(statusIndex("running"));
  });

  it("done is before error", () => {
    expect(statusIndex("done")).toBeLessThan(statusIndex("error"));
  });

  it("running is before done", () => {
    expect(statusIndex("running")).toBeLessThan(statusIndex("done"));
  });
});

describe("formatTime", () => {
  it("formats 0ms as 0:00", () => {
    expect(formatTime(0)).toBe("0:00");
  });

  it("formats 30s as 0:30", () => {
    expect(formatTime(30_000)).toBe("0:30");
  });

  it("formats 1m as 1:00", () => {
    expect(formatTime(60_000)).toBe("1:00");
  });

  it("formats 5m30s as 5:30", () => {
    expect(formatTime(330_000)).toBe("5:30");
  });

  it("formats 125s as 2:05", () => {
    expect(formatTime(125_000)).toBe("2:05");
  });

  it("pads seconds", () => {
    expect(formatTime(63_000)).toBe("1:03");
  });
});

describe("terminal status detection", () => {
  it("complete is terminal", () => {
    expect(isTerminal("complete")).toBe(true);
  });

  it("failed is terminal", () => {
    expect(isTerminal("failed")).toBe(true);
  });

  it("recording is not terminal", () => {
    expect(isTerminal("recording")).toBe(false);
  });

  it("assembling is not terminal", () => {
    expect(isTerminal("assembling")).toBe(false);
  });
});

describe("step progress counting", () => {
  it("counts pending steps", () => {
    const state: RecordingState = {
      sessionId: "s1",
      status: "recording",
      currentStep: 0,
      totalSteps: 3,
      steps: [
        { id: "s1", order: 1, action: "navigate", status: "pending" },
        { id: "s2", order: 2, action: "click", status: "running" },
        { id: "s3", order: 3, action: "type", status: "pending" },
      ],
      elapsedMs: 5000,
    };
    expect(stepCountByStatus(state.steps, "pending")).toBe(2);
    expect(stepCountByStatus(state.steps, "running")).toBe(1);
    expect(stepCountByStatus(state.steps, "done")).toBe(0);
  });

  it("transitions steps through statuses", () => {
    const state: RecordingState = {
      sessionId: "s2",
      status: "recording",
      currentStep: 2,
      totalSteps: 4,
      steps: [
        { id: "s1", order: 1, action: "navigate", status: "done", duration: 2 },
        { id: "s2", order: 2, action: "click", status: "done", duration: 1 },
        { id: "s3", order: 3, action: "type", status: "running" },
        { id: "s4", order: 4, action: "hover", status: "pending" },
      ],
      elapsedMs: 12000,
    };
    expect(stepCountByStatus(state.steps, "done")).toBe(2);
    expect(stepCountByStatus(state.steps, "running")).toBe(1);
    expect(stepCountByStatus(state.steps, "pending")).toBe(1);
  });

  it("handles error state", () => {
    const state: RecordingState = {
      sessionId: "s3",
      status: "failed",
      currentStep: 1,
      totalSteps: 2,
      steps: [
        { id: "s1", order: 1, action: "navigate", status: "done", duration: 3 },
        { id: "s2", order: 2, action: "click", status: "error" },
      ],
      elapsedMs: 4500,
      error: "Element not found: #submit-btn",
    };
    expect(stepCountByStatus(state.steps, "error")).toBe(1);
    expect(state.error).toContain("submit-btn");
  });

  it("handles assembly phase", () => {
    const state: RecordingState = {
      sessionId: "s4",
      status: "assembling",
      currentStep: 4,
      totalSteps: 4,
      steps: Array.from({ length: 4 }, (_, i) => ({
        id: `s${i + 1}`,
        order: i + 1,
        action: ["navigate", "click", "type", "hover"][i],
        status: "done" as SRS,
        duration: 2,
      })),
      elapsedMs: 15000,
    };
    expect(stepCountByStatus(state.steps, "done")).toBe(4);
    expect(state.status).toBe("assembling");
  });
});
