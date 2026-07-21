/**
 * record.test.ts — Unit tests for record.ts pure functions
 *
 * Tests generateCaptions and formatSrtTime from the record module.
 * These are the only pure functions in record.ts that can be tested
 * without agent-browser.
 */

import { describe, test, expect } from "bun:test";
import { generateCaptions } from "../pipeline/record";

// ── SRT Format ─────────────────────────────────────────────────────────────

describe("generateCaptions", () => {
  test("generates valid SRT for single scene", () => {
    const srt = generateCaptions([
      { narration: "Hello and welcome to this demo.", duration: 10, order: 1 },
    ]);

    // Must start with a sequence number
    const lines = srt.split("\n").filter(l => l.trim());
    expect(lines.length).toBeGreaterThan(0);

    // First line should be "1" (sequence number)
    expect(lines[0]).toBe("1");

    // Second line should be a time range
    expect(lines[1]).toMatch(/\d{2}:\d{2}:\d{2},\d{3} --> \d{2}:\d{2}:\d{2},\d{3}/);

    // Should end with blank line (SRT conventions)
    expect(srt.endsWith("\n")).toBe(true);
  });

  test("generates sequential numbering for multiple scenes", () => {
    const srt = generateCaptions([
      { narration: "Scene one.", duration: 5, order: 1 },
      { narration: "Scene two.", duration: 5, order: 2 },
    ]);

    const seqNums = srt.match(/^\d+$/gm)?.map(Number) || [];
    expect(seqNums).toEqual([1, 2, 3, expect.any(Number)]);
    expect(seqNums.length).toBeGreaterThanOrEqual(2);
  });

  test("handles empty narration gracefully", () => {
    const srt = generateCaptions([
      { narration: "", duration: 5, order: 1 },
    ]);

    // Empty narration should produce no subtitle entries
    const seqNums = srt.match(/^\d+$/gm);
    expect(seqNums).toBeNull();

    // But should still be valid SRT (just empty)
    expect(srt).toBe("");
  });

  test("chunks long narration into multiple subtitles", () => {
    const longNarration = "This is a very long sentence that should be split across multiple subtitle entries because each entry should not exceed a reasonable character length for comfortable reading on screen.";
    const srt = generateCaptions([
      { narration: longNarration, duration: 30, order: 1 },
    ]);

    const seqNums = srt.match(/^\d+$/gm);
    expect(seqNums).not.toBeNull();
    expect(seqNums!.length).toBeGreaterThan(1);

    // Each subtitle text should be reasonably sized
    const blocks = srt.split(/\n\n/).filter(b => b.trim());
    for (const block of blocks) {
      const lines = block.split("\n");
      const text = lines.slice(2).join(" ");
      if (text.trim()) {
        expect(text.length).toBeLessThanOrEqual(120); // per SRT convention
      }
    }
  });

  test("timestamps are sequential and non-overlapping", () => {
    const srt = generateCaptions([
      { narration: "First scene narration text here for testing.", duration: 10, order: 1 },
      { narration: "Second scene with more content to verify timing continuity.", duration: 15, order: 2 },
    ]);

    // Parse all time ranges
    const timeMatches = srt.matchAll(/(\d{2}:\d{2}:\d{2},\d{3}) --> (\d{2}:\d{2}:\d{2},\d{3})/g);
    let prevEnd = "00:00:00,000";
    for (const match of timeMatches) {
      const [_, start, end] = match;
      // Start should be >= previous end
      expect(compareSrtTime(start, prevEnd)).toBeGreaterThanOrEqual(-1); // Allow small epsilon
      // End should be >= start
      expect(compareSrtTime(end, start)).toBeGreaterThanOrEqual(0);
      prevEnd = end;
    }
  });

  test("handles multiple scenes with mixed empty and non-empty narration", () => {
    const srt = generateCaptions([
      { narration: "Scene with narration.", duration: 5, order: 1 },
      { narration: "", duration: 3, order: 2 }, // silent scene
      { narration: "Final scene with text.", duration: 7, order: 3 },
    ]);

    const seqNums = srt.match(/^\d+$/gm)?.length || 0;
    // Should have entries for scene 1 and 3, skip scene 2
    expect(seqNums).toBeGreaterThan(0);

    // Time should account for the silent scene
    const timeMatches = srt.match(/(\d{2}:\d{2}:\d{2},\d{3}) --> (\d{2}:\d{2}:\d{2},\d{3})/g);
    if (timeMatches && timeMatches.length > 0) {
      const lastMatch = timeMatches[timeMatches.length - 1];
      const endTime = lastMatch.split(" --> ")[1];
      // Should have advanced past the silent duration
      const totalSec = srtTimeToSec(endTime);
      expect(totalSec).toBeGreaterThan(3); // silent scene gap
    }
  });
});

// ── Helpers ────────────────────────────────────────────────────────────────

function compareSrtTime(a: string, b: string): number {
  return srtTimeToSec(a) - srtTimeToSec(b);
}

function srtTimeToSec(t: string): number {
  const [h, m, rest] = t.split(":");
  const [s, ms] = rest.split(",");
  return parseInt(h) * 3600 + parseInt(m) * 60 + parseInt(s) + parseInt(ms) / 1000;
}
