#!/usr/bin/env python3
"""Generate a transparent cursor overlay video from an interaction log.

Usage:
  gen-cursor-video.py --interactions interactions.json --output cursor.mov --fps 30 --width 1280 --height 720

Reads the interaction log (JSON array of {type, timestamp, data: {x?, y?}} events)
and renders a ProRes 4444 MOV with the cursor at the tracked position per frame.
Click events get an additional expanding ripple effect.
"""

import argparse, json, struct, subprocess, sys, math, os
from PIL import Image, ImageDraw

CURSOR_POINTS = [
    (2, 2), (2, 26), (9, 20), (14, 30), (17, 29),
    (12, 19), (22, 18),
]
CURSOR_W, CURSOR_H = 32, 32


def draw_cursor(draw: ImageDraw.ImageDraw, x: int, y: int, color: tuple[int, ...] = (0, 0, 0)) -> None:
    """Draw a simple arrow cursor at (x,y) in the given color."""
    for i in range(len(CURSOR_POINTS) - 1):
        draw.line([(x + CURSOR_POINTS[i][0], y + CURSOR_POINTS[i][1]),
                   (x + CURSOR_POINTS[i + 1][0], y + CURSOR_POINTS[i + 1][1])],
                  fill=color, width=2)
    # Fill polygon
    draw.polygon([(x + px, y + py) for px, py in CURSOR_POINTS], fill=color)


def draw_click_ripple(draw: ImageDraw.ImageDraw, cx: int, cy: int,
                      radius: float, alpha: int) -> None:
    """Draw a translucent expanding circle at (cx, cy)."""
    r = int(radius)
    rgba = (255, 80, 80, alpha)
    # Pillow doesn't support RGBA in draw.ellipse directly, so we composite
    ripple = Image.new("RGBA", (r * 2 + 10, r * 2 + 10), (0, 0, 0, 0))
    rd = ImageDraw.Draw(ripple)
    rd.ellipse([0, 0, r * 2 + 8, r * 2 + 8], outline=(255, 80, 80, alpha), width=3)
    draw.bitmap((cx - r - 4, cy - r - 4), ripple)


def generate_cursor_video(interactions_path: str, output_path: str,
                          fps: int, width: int, height: int) -> None:
    with open(interactions_path) as f:
        events = json.load(f)

    if not events:
        # No events — generate blank video
        total_frames = int(10 * fps)  # 10 seconds default
        _write_blank_mov(output_path, total_frames, width, height, fps)
        return

    total_ms = max(e["timestamp"] for e in events if "timestamp" in e) + 5000
    total_frames = int(total_ms * fps / 1000) + 1

    # Build cursor position timeline: sample every 16ms (≈60fps query rate)
    # Interpolate between known mouse positions
    mouse_events = [
        e for e in events
        if e["type"] in ("mousemove", "click") and
        "data" in e and "x" in e["data"] and "y" in e["data"]
    ]
    mouse_events.sort(key=lambda e: e["timestamp"])

    # Build click events timeline
    click_events = [
        e for e in events
        if e["type"] == "click" and
        "data" in e and "x" in e["data"] and "y" in e["data"]
    ]

    # Generate frames as raw RGBA, pipe to ffmpeg
    cmd = [
        "ffmpeg", "-y",
        "-f", "rawvideo",
        "-pixel_format", "rgba",
        "-video_size", f"{width}x{height}",
        "-framerate", str(fps),
        "-i", "pipe:0",
        "-c:v", "prores_ks",
        "-profile:v", "4444",
        "-pix_fmt", "yuva444p10le",
        "-r", str(fps),
        output_path
    ]
    proc = subprocess.Popen(cmd, stdin=subprocess.PIPE, stderr=subprocess.PIPE)

    bytecount = width * height * 4  # RGBA

    mouse_idx = 0
    prev_x, prev_y = width / 2, height / 2
    cur_x, cur_y = prev_x, prev_y

    frame_dur_ms = 1000.0 / fps

    for frame in range(total_frames):
        t_ms = frame * frame_dur_ms

        # Interpolate cursor position
        while mouse_idx < len(mouse_events) - 1 and mouse_events[mouse_idx + 1]["timestamp"] <= t_ms:
            mouse_idx += 1

        if mouse_idx < len(mouse_events):
            e = mouse_events[mouse_idx]
            cur_x = float(e["data"].get("x", cur_x))
            cur_y = float(e["data"].get("y", cur_y))
        else:
            # No event yet — use last known
            pass

        # Create frame
        img = Image.new("RGBA", (width, height), (0, 0, 0, 0))
        draw = ImageDraw.Draw(img, "RGBA")

        # Draw cursor
        draw_cursor(draw, int(cur_x), int(cur_y), (0, 0, 0, 255))
        draw_cursor(draw, int(cur_x) - 1, int(cur_y) - 1, (255, 255, 255, 255))

        # Draw click ripples (check if a click happened within 500ms of this frame)
        for ce in click_events:
            dt = t_ms - ce["timestamp"]
            if 0 <= dt <= 500:
                # Ripple expands and fades
                progress = dt / 500.0  # 0 to 1
                max_radius = 80
                radius = max_radius * progress
                alpha = int(180 * (1 - progress))
                cx = float(ce["data"].get("x", cur_x))
                cy = float(ce["data"].get("y", cur_y))
                draw_click_ripple(draw, int(cx), int(cy), radius, alpha)

        # Write raw RGBA bytes
        proc.stdin.write(img.tobytes())

    proc.stdin.close()
    proc.wait()
    if proc.returncode != 0:
        err = proc.stderr.read()
        raise RuntimeError(f"ffmpeg cursor render failed:\n{err.decode(errors='replace')}")
    print(f"Cursor video: {output_path} ({total_frames} frames)", file=sys.stderr)


def _write_blank_mov(path: str, total_frames: int, w: int, h: int, fps: int) -> None:
    cmd = [
        "ffmpeg", "-y",
        "-f", "rawvideo", "-pixel_format", "rgba",
        "-video_size", f"{w}x{h}", "-framerate", str(fps),
        "-i", "pipe:0",
        "-c:v", "prores_ks", "-profile:v", "4444",
        "-pix_fmt", "yuva444p10le", "-r", str(fps),
        path
    ]
    proc = subprocess.Popen(cmd, stdin=subprocess.PIPE, stderr=subprocess.DEVNULL)
    row = b"\x00" * (w * 4)
    blank_frame = row * h
    for _ in range(total_frames):
        proc.stdin.write(blank_frame)
    proc.stdin.close()
    proc.wait()


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--interactions", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--fps", type=int, default=30)
    parser.add_argument("--width", type=int, default=1280)
    parser.add_argument("--height", type=int, default=720)
    args = parser.parse_args()
    generate_cursor_video(args.interactions, args.output, args.fps, args.width, args.height)
