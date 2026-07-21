#!/usr/bin/env python3
"""Generate cursor overlay video frames from interaction log.

Produces a transparent MP4 with cursor at tracked positions + click ripples.
"""
import json, sys, os
from PIL import Image, ImageDraw

CURSOR_SIZE = 32
CLICK_RIPPLE_FRAMES = 15
OUT_FPS = 30

def gen_arrow(draw, x, y, scale=1.0, color=(0, 0, 0, 200)):
    s = scale
    points = [
        (x, y), (x, y + 18*s), (x + 6*s, y + 12*s),
        (x + 10*s, y + 22*s), (x + 13*s, y + 21*s),
        (x + 9*s, y + 11*s), (x + 16*s, y + 10*s),
    ]
    draw.polygon(points, fill=color, outline=(255, 255, 255, 180))

def gen_click_ripple(draw, cx, cy, frame_idx, total_frames=15, max_radius=40):
    frac = frame_idx / total_frames
    radius = int(max_radius * frac * 0.8)
    alpha = int(180 * (1 - frac))
    if radius < 2: return
    draw.ellipse(
        [cx - radius, cy - radius, cx + radius, cy + radius],
        outline=(255, 100, 50, alpha), width=2
    )
    inner_r = max(1, radius - 3)
    fill_alpha = int(60 * (1 - frac))
    if fill_alpha > 0:
        draw.ellipse(
            [cx - inner_r, cy - inner_r, cx + inner_r, cy + inner_r],
            fill=(255, 100, 50, fill_alpha)
        )

def main():
    if len(sys.argv) < 4:
        print(f"Usage: {sys.argv[0]} <interactions.json> <output.mp4> <width> <height>", file=sys.stderr)
        sys.exit(1)
    
    log_path = sys.argv[1]
    out_path = sys.argv[2]
    vw = int(sys.argv[3])
    vh = int(sys.argv[4])
    
    with open(log_path) as f:
        events = json.load(f)
    
    if not events:
        import subprocess as sp
        sp.run(["ffmpeg","-y","-f","lavfi","-i",f"color=c=0x00000000:s={vw}x{vh}:r={OUT_FPS}:d=0.1","-c:v","png","-pix_fmt","rgba",out_path], capture_output=True)
        return
    
    total_ms = max(e.get("timestamp", 0) for e in events)
    total_ms = max(total_ms, 5000)
    total_frames = int(total_ms / 1000 * OUT_FPS) + 30
    
    cursor_pos = {}
    click_events = []
    last_x, last_y = vw // 2, vh // 2
    
    for e in events:
        frame = int(e["timestamp"] / 1000 * OUT_FPS)
        if e["type"] == "mousemove":
            d = e.get("data", {})
            last_x = int(d.get("x", last_x))
            last_y = int(d.get("y", last_y))
            cursor_pos[frame] = (last_x, last_y)
        elif e["type"] == "click":
            d = e.get("data", {})
            cx = int(d.get("x", last_x))
            cy = int(d.get("y", last_y))
            click_events.append((frame, cx, cy))
            cursor_pos[frame] = (cx, cy)
            last_x, last_y = cx, cy
    
    sorted_frames = sorted(cursor_pos.keys())
    def get_cursor(f):
        if not sorted_frames:
            return (vw // 2, vh // 2)
        if f <= sorted_frames[0]:
            return cursor_pos[sorted_frames[0]]
        if f >= sorted_frames[-1]:
            return cursor_pos[sorted_frames[-1]]
        for i in range(len(sorted_frames) - 1):
            if sorted_frames[i] <= f < sorted_frames[i+1]:
                a, b = sorted_frames[i], sorted_frames[i+1]
                t = (f - a) / (b - a)
                x1, y1 = cursor_pos[a]; x2, y2 = cursor_pos[b]
                return (int(x1 + t*(x2-x1)), int(y1 + t*(y2-y1)))
        return cursor_pos[sorted_frames[-1]]
    
    import subprocess as sp
    cmd = [
        "ffmpeg", "-y",
        "-f", "rawvideo",
        "-pixel_format", "rgba",
        "-video_size", f"{vw}x{vh}",
        "-framerate", str(OUT_FPS),
        "-i", "pipe:",
        "-c:v", "libx264", "-preset", "fast",
        "-pix_fmt", "yuva420p",
        "-crf", "23",
        out_path
    ]
    proc = sp.Popen(cmd, stdin=sp.PIPE)
    
    for f in range(total_frames):
        frame = Image.new("RGBA", (vw, vh), (0, 0, 0, 0))
        draw = ImageDraw.Draw(frame)
        cx, cy = get_cursor(f)
        gen_arrow(draw, cx, cy)
        for click_frame, click_x, click_y in click_events:
            df = f - click_frame
            if 0 <= df < CLICK_RIPPLE_FRAMES:
                gen_click_ripple(draw, click_x, click_y, df, CLICK_RIPPLE_FRAMES)
        proc.stdin.write(frame.tobytes())
    
    proc.stdin.close()
    proc.wait()
    
    if proc.returncode != 0:
        print(f"Error: ffmpeg cursor render failed ({proc.returncode})", file=sys.stderr)
        sys.exit(1)
    print(f"[Cursor] {total_frames} frames → {out_path}")

if __name__ == "__main__":
    main()
