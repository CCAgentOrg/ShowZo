#!/usr/bin/env python3
"""Generate intro and outro card images for ShowZo walkthrough videos.

Usage:
  gen-intro-outro.py --title "How to use XYZ" --subtitle "A ShowZo Walkthrough" \
    --output-dir /path/to/frames --fps 30 --width 1280 --height 720 \
    [--duration 3] [--logo /path/to/logo.png]

Generates intro card frames (centered title animating in) and outro card frames
(as separate PNGs in output-dir/intro-*.png and output-dir/outro-*.png).

Also writes the ffmpeg concat file paths for each segment.
"""

import argparse, os, math, sys
from PIL import Image, ImageDraw, ImageFont


def find_font(size: int = 48) -> ImageFont.FreeTypeFont:
    """Find a good sans-serif font available on the system."""
    candidates = [
        "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
        "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
        "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf",
        "/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf",
        "/usr/share/fonts/truetype/ubuntu/Ubuntu-Bold.ttf",
        "/usr/share/fonts/truetype/ubuntu/Ubuntu-Regular.ttf",
        "/usr/share/fonts/truetype/noto/NotoSans-Bold.ttf",
        "/usr/share/fonts/truetype/noto/NotoSans-Regular.ttf",
    ]
    for path in candidates:
        if os.path.exists(path):
            return ImageFont.truetype(path, size)
    return ImageFont.load_default()


def gen_frames(args) -> None:
    w, h, fps = args.width, args.height, args.fps
    intro_dur = args.intro_duration
    outro_dur = args.outro_duration
    out = args.output_dir
    os.makedirs(out, exist_ok=True)

    font_title = find_font(64)
    font_sub = find_font(32)
    font_powered = find_font(18)

    # ── Intro frames ────────────────────────────────────────────────────
    intro_frames_total = int(intro_dur * fps)
    # Background: dark gradient
    bg_dark = (16, 16, 20)
    bg_mid = (24, 24, 32)
    accent = (220, 160, 80)  # warm gold

    for i in range(intro_frames_total):
        progress = i / max(intro_frames_total - 1, 1)  # 0 to 1
        # Ease out cubic
        ease = 1 - (1 - progress) ** 3

        img = Image.new("RGBA", (w, h), bg_dark)
        draw = ImageDraw.Draw(img, "RGBA")

        # Subtle gradient line across top
        draw.rectangle([0, 0, w, 4], fill=accent + (255,))

        # Title — slides up from below, stops at center
        title_y = int(h * 0.38) if ease >= 0.99 else int(h * 0.38 + (1 - ease) * 80)
        title_text = args.title
        bbox = draw.textbbox((0, 0), title_text, font=font_title)
        tw, _ = bbox[2] - bbox[0], bbox[3] - bbox[1]
        tx = (w - tw) // 2
        draw.text((tx, title_y), title_text, fill=(255, 255, 255, 255), font=font_title)

        # Subtitle — fades in after title arrives
        sub_alpha = max(0, min(255, int(255 * (progress - 0.4) / 0.6)))
        if sub_alpha > 0:
            sub_text = args.subtitle
            bbox2 = draw.textbbox((0, 0), sub_text, font=font_sub)
            sw, _ = bbox2[2] - bbox2[0], bbox2[3] - bbox2[1]
            sx = (w - sw) // 2
            sy = title_y + 90
            draw.text((sx, sy), sub_text, fill=(200, 200, 200, sub_alpha), font=font_sub)

        # "Powered by ShowZo" at bottom
        powered_text = "powered by ShowZo"
        bbox3 = draw.textbbox((0, 0), powered_text, font=font_powered)
        pw, _ = bbox3[2] - bbox3[0], bbox3[3] - bbox3[1]
        px = (w - pw) // 2
        py = int(h * 0.9 + (1 - ease) * 30)
        draw.text((px, py), powered_text, fill=(120, 120, 130, int(180 * ease)), font=font_powered)

        path = os.path.join(out, f"intro-{i:05d}.png")
        img.save(path)

    # ── Outro frames ─────────────────────────────────────────────────────
    outro_frames_total = int(outro_dur * fps)
    for i in range(outro_frames_total):
        progress = i / max(outro_frames_total - 1, 1)

        img = Image.new("RGBA", (w, h), bg_mid)
        draw = ImageDraw.Draw(img, "RGBA")

        # Accent line at top
        draw.rectangle([0, 0, w, 4], fill=accent + (255,))

        # Thank you text (fade in)
        alpha = min(255, int(255 * progress / 0.3))
        thanks = "Thank you for watching!"
        draw.text((w // 2 - 200, int(h * 0.35)),
                  thanks, fill=(255, 255, 255, int(alpha * 0.9)), font=font_title)

        # CTA
        cta_alpha = max(0, min(255, int(255 * (progress - 0.3) / 0.5)))
        if cta_alpha > 0:
            cta = "Made with ShowZo — Agentic Walkthrough Video"
            bbox = draw.textbbox((0, 0), cta, font=font_sub)
            cw, _ = bbox[2] - bbox[0], bbox[3] - bbox[1]
            draw.text(((w - cw) // 2, int(h * 0.55)),
                      cta, fill=(180, 180, 200, cta_alpha), font=font_sub)

        # URL
        url_text = "github.com/CCAgentOrg/ShowZo"
        draw.text((w // 2 - 180, int(h * 0.7)),
                  url_text, fill=(220, 160, 80, int(200 * progress)), font=font_powered)

        path = os.path.join(out, f"outro-{i:05d}.png")
        img.save(path)

    # ── Write concat file for intro ──────────────────────────────────────
    with open(os.path.join(out, "intro_concat.txt"), "w") as cf:
        cf.write(f"ffconcat version 1.0\n")
        for i in range(intro_frames_total):
            fpath = os.path.join(out, f"intro-{i:05d}.png")
            dur = 1.0 / fps
            cf.write(f"file {fpath}\nduration {dur:.6f}\n")

    with open(os.path.join(out, "outro_concat.txt"), "w") as cf:
        cf.write(f"ffconcat version 1.0\n")
        for i in range(outro_frames_total):
            fpath = os.path.join(out, f"outro-{i:05d}.png")
            dur = 1.0 / fps
            cf.write(f"file {fpath}\nduration {dur:.6f}\n")

    print(f"Intro: {intro_frames_total} frames ({intro_dur}s)", file=sys.stderr)
    print(f"Outro: {outro_frames_total} frames ({outro_dur}s)", file=sys.stderr)
    print(f"Output: {out}/", file=sys.stderr)


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--title", default="Walkthrough")
    parser.add_argument("--subtitle", default="A ShowZo Walkthrough")
    parser.add_argument("--output-dir", required=True)
    parser.add_argument("--fps", type=int, default=30)
    parser.add_argument("--width", type=int, default=1280)
    parser.add_argument("--height", type=int, default=720)
    parser.add_argument("--intro-duration", type=float, default=3.0)
    parser.add_argument("--outro-duration", type=float, default=3.0)
    args = parser.parse_args()
    gen_frames(args)
