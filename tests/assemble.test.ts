/**
 * assemble.test.ts — Unit tests for assemble.ts pure functions
 *
 * Tests time formatting, zoom math, cursor positioning calculations,
 * and ffmpeg filter generation.
 */

import { describe, test, expect } from "bun:test";

// ── These functions exist inside assemble.ts; we re-implement their
//     pure-logic parts here to test the math independently.
// ────────────────────────────────────────────────────────────────────────────

function fmtSrt(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  const ms = Math.round((sec - Math.floor(sec)) * 1000);
  return `${pad(h)}:${pad(m)}:${pad(s)},${String(ms).padStart(3, "0")}`;
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

/**
 * Calculate cursor screen position after zoom.
 * After zoompan scales the viewport by `scale` around center (CX, CY),
 * a point at (px, py) in raw coordinates maps to:
 *   screenX = px * scale - (scale - 1) * CX
 *   screenY = py * scale - (scale - 1) * CY
 */
function cursorScreenPos(
  px: number, py: number,
  scale: number,
  viewportW: number,
  viewportH: number,
): { x: number; y: number } {
  const cx = viewportW / 2;
  const cy = viewportH / 2;
  return {
    x: px * scale - (scale - 1) * cx,
    y: py * scale - (scale - 1) * cy,
  };
}

/**
 * Generate the zoompan filter string for a scene segment.
 */
function buildZoompanFilter(
  startSec: number,
  durSec: number,
  zoomScale: number,
  zoomCenterX: number,
  zoomCenterY: number,
  viewportW: number,
  viewportH: number,
  frames: number,
): string {
  const cx = viewportW / 2;
  const cy = viewportH / 2;
  const offX = zoomCenterX - cx;
  const offY = zoomCenterY - cy;

  return [
    `trim=start=${startSec.toFixed(2)}:duration=${durSec.toFixed(2)}`,
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
      `s=${viewportW}x${viewportH}:d=${frames}`,
  ].join(",");
}

// ── SRT Time Formatting ───────────────────────────────────────────────────

describe("fmtSrt", () => {
  test("formats 0 seconds", () => {
    expect(fmtSrt(0)).toBe("00:00:00,000");
  });

  test("formats whole seconds", () => {
    expect(fmtSrt(5)).toBe("00:00:05,000");
    expect(fmtSrt(65)).toBe("00:01:05,000");
    expect(fmtSrt(3665)).toBe("01:01:05,000");
  });

  test("formats fractional seconds", () => {
    expect(fmtSrt(1.5)).toBe("00:00:01,500");
    expect(fmtSrt(2.75)).toBe("00:00:02,750");
    expect(fmtSrt(0.001)).toBe("00:00:00,001");
  });

  test("formats max realistic duration", () => {
    // 1 hour 59 minutes 59 seconds 999 ms
    expect(fmtSrt(7199.999)).toBe("01:59:59,999");
  });
});

// ── Cursor Screen Position ─────────────────────────────────────────────────

describe("cursorScreenPos", () => {
  const VW = 1280, VH = 720;
  const CX = 640, CY = 360;

  test("at scale 1.0, cursor position is unchanged", () => {
    const result = cursorScreenPos(200, 300, 1.0, VW, VH);
    expect(result.x).toBeCloseTo(200, 1);
    expect(result.y).toBeCloseTo(300, 1);
  });

  test("at center with any scale, position is center", () => {
    const result = cursorScreenPos(CX, CY, 2.0, VW, VH);
    expect(result.x).toBeCloseTo(CX, 1);
    expect(result.y).toBeCloseTo(CY, 1);
  });

  test("at scale 2.0, left edge moves further left", () => {
    const result = cursorScreenPos(0, 0, 2.0, VW, VH);
    // screenX = 0*2 - (2-1)*640 = -640
    // screenY = 0*2 - (2-1)*360 = -360
    expect(result.x).toBeCloseTo(-640, 1);
    expect(result.y).toBeCloseTo(-360, 1);
  });

  test("at scale 2.0, 3/4 point shifts proportionally", () => {
    // Point at 75% of viewport
    const result = cursorScreenPos(960, 540, 2.0, VW, VH);
    // screenX = 960*2 - (2-1)*640 = 1920-640 = 1280
    // screenY = 540*2 - (2-1)*360 = 1080-360 = 720
    expect(result.x).toBeCloseTo(1280, 1);
    expect(result.y).toBeCloseTo(720, 1);
  });
});

// ── Zoompan Filter Generation ──────────────────────────────────────────────

describe("buildZoompanFilter", () => {
  const VW = 1280, VH = 720;
  const CX = VW / 2, CY = VH / 2;

  test("generates valid zoompan filter string", () => {
    const filter = buildZoompanFilter(0, 10, 1.5, 400, 300, VW, VH, 300);
    expect(filter).toContain("trim=start=0.00:duration=10.00");
    expect(filter).toContain("setpts=PTS-STARTPTS");
    expect(filter).toContain("zoompan");
    expect(filter).toContain(`s=${VW}x${VH}:d=300`);
  });

  test("zoompan includes ease-in / ease-out (on between 0,15)", () => {
    const filter = buildZoompanFilter(0, 10, 2.0, CX, CY, VW, VH, 300);
    expect(filter).toContain("between(on,0,15)");
    expect(filter).toContain(`between(on,${300 - 15},${300})`);
  });

  test("zoompan offset is zero when center is viewport center", () => {
    const filter = buildZoompanFilter(0, 10, 2.0, CX, CY, VW, VH, 300);
    // At center: offX = 640 - 640 = 0, offY = 360 - 360 = 0
    expect(filter).toContain(`+0/zoom`);
  });

  test("zoompan offset is negative when target is left of center", () => {
    const filter = buildZoompanFilter(0, 10, 1.5, 100, 360, VW, VH, 300);
    // offX = 100 - 640 = -540
    expect(filter).toContain(`+-540/zoom`);
  });
});

// ── SRT round-trip (edge cases) ───────────────────────────────────────────

describe("fmtSrt edge cases", () => {
  test("handles very small values", () => {
    const result = fmtSrt(0.001);
    expect(result.split(",")[1]).toBe("001");
  });

  test("handles values just below 1ms boundary", () => {
    expect(fmtSrt(0.000)).toBe("00:00:00,000");
  });

  test("pads all fields correctly", () => {
    const result = fmtSrt(1);
    expect(result).toMatch(/^\d{2}:\d{2}:\d{2},\d{3}$/);
    expect(result).toBe("00:00:01,000");
  });
});

// ── Determinism ────────────────────────────────────────────────────────────

describe("output determinism", () => {
  test("same inputs produce identical SRT times", () => {
    const a = fmtSrt(12.345);
    const b = fmtSrt(12.345);
    expect(a).toBe(b);
  });

  test("same inputs produce identical zoompan filters", () => {
    const vw = 1280, vh = 720;
    const a = buildZoompanFilter(1.5, 8.0, 1.8, 320, 240, vw, vh, 240);
    const b = buildZoompanFilter(1.5, 8.0, 1.8, 320, 240, vw, vh, 240);
    expect(a).toBe(b);
  });
});
