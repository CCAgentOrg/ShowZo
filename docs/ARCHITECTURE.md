# ShowZo Architecture

## Overview

ShowZo is a monorepo with three layers: Web UI, Orchestration API, and Recording Pipeline.
All layers run on the user's Zo Computer — nothing leaves the personal server.

## Layers

### 1. Web UI (`app/`)

React + Tailwind + TypeScript Zo Site. Page routes:

| Route | Purpose |
|-------|---------|
| `/` | URL + scenario input form |
| `/plan/:id` | Review generated plan steps, edit, approve |
| `/record/:id` | Live progress view during recording |
| `/output/:id` | Preview and download final video |

### 2. API Routes (`app/api/`)

Hono API routes on zo.space or Zo Site:

| Route | Method | Purpose |
|-------|--------|---------|
| `/api/plan` | POST | Takes URL + scenario, returns action plan |
| `/api/record` | POST | Accepts approved plan, starts recording |
| `/api/status/:id` | GET | Returns current recording progress |
| `/api/output/:id` | GET | Returns final video file URL |

### 3. Pipeline (`pipeline/`)

Bun TypeScript modules (no external runtime deps):

| Module | Function |
|--------|----------|
| `plan.ts` | LLM: scenario text → structured action steps |
| `record.ts` | agent-browser: execute steps, capture .webm |
| `narrate.ts` | edge-tts: generate .wav for each step |
| `assemble.ts` | ffmpeg: composite recording + audio + overlays |
| `types.ts` | Shared types (Step, Plan, Session) |

## Data Flow

```
User Input → /api/plan → plan.ts → ActionPlan
                ↓
          User reviews plan in UI
                ↓
User Approves → /api/record → record.ts → raw-recording.webm
                                  ↓
                            narrate.ts → audio/*.wav
                                  ↓
                            assemble.ts → final-video.mp4
                                  ↓
          /api/output serves final file
```

## Video Pipeline Detail

The recording pipeline is a two-pass process (Mux-inspired):

**Pass 1 — Action Execution:**
1. Open URL in headless Chromium via agent-browser
2. For each step: take DOM snapshot, execute action, wait for render
3. Record full session as raw `.webm` (VP8/VP9, 1280×720, 30fps)

**Pass 2 — Narration + Assembly:**
1. Generate TTS audio for each step narration via edge-tts
2. Frame-accurate audio splicing using step timestamps
3. Add translucent cursor highlight overlay
4. Composite final MP4 with ffmpeg

## Deployment

All three layers deploy on Zo Computer infrastructure:
- Web UI + API → Zo Site (`app/` with zosite.json)
- Pipeline runs as local process (mode="process" user service or CLI)
- Outputs stored in workspace, served through API
