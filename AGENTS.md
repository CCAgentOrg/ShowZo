# ShowZo AGENTS.md

_Last updated: 2026-07-22 — Hackathon submission ready_

## What is ShowZo

Agentic walkthrough video generator. Input a URL + scenario, get a produced product walkthrough video with narration, cursor effects, and transitions.

## Architecture

```
┌─────────────────────────────────────┐
│  Web UI (React + Vite)              │
│  Input → Plan → Record → Preview    │
└──────────┬──────────────────────────┘
           │ POST /api/plan, /api/record
           │ GET  /api/session/:id
           ▼
┌─────────────────────────────────────┐
│  API Server (Hono + Bun)            │
│  Plan generation (Zo /ask)          │
│  Recording orchestrator             │
│  Video assembly (ffmpeg)            │
└──────────┬──────────────────────────┘
           │
     ┌─────┴─────┐
     ▼           ▼
┌─────────┐ ┌─────────┐
│agent-   │ │ ffmpeg  │
│browser  │ │ Video   │
│Screens  │ │ assy    │
│hots     │ │ + audio │
└─────────┘ └─────────┘
```

## Directory Layout

- `server.ts` — Hono API server (routes + recording orchestrator)
- `src/showzo/` — Web UI components and pipeline modules
  - `src/showzo/App.tsx` — Main React component (form → plan → record → preview)
  - `src/showzo/api/plan.mjs` — LLM plan generator (Zo /ask)
  - `src/showzo/pipeline/` — TypeScript recording pipeline modules
    - `types.ts` — Plan, Session, Step types
    - `runner.ts` — Agent-browser execution runner
    - `record.ts` — Screen recording, narration, assembly
- `tests/` — Unit tests for pipeline modules
- `docs/ARCHITECTURE.md` — Detailed architecture with competitive analysis

## Key Commands

```bash
# Dev server
bun run dev

# Production build + run
bun run prod

# Type check only
bunx tsc --noEmit

# Tests
bun test
```

## Competitive Advantage

Unlike SaaS walkthrough tools (Trupeer, StoryX, Demostack):
- **Open source + self-hosted** — runs on Zo Computer
- **AI scene generation** — LLM generates step-by-step plans from natural language
- **Real browser recording** — not a mockup builder
- **Agentic** — browser automation executes the walkthrough autonomously

## Pipeline Workflow

1. User inputs URL + scenario → POST /api/plan
2. LLM generates structured plan (steps with actions, selectors, narration)
3. User reviews plan → POST /api/record
4. Agent-browser opens URL, executes steps (click, type, scroll, etc.)
5. Screenshots captured at each step
6. Edge TTS generates narration audio per step
7. FFmpeg assembles screenshots + audio → final video
8. User previews and downloads video

## Active Issues

- #12 — Screenshot-snapshot fallback mode (for when pages can't be navigated)
- #19 — Record dogfood demo video (ShowZo recording itself)
- #20 — Hackathon submission writeup
