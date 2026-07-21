# ShowZo AGENTS.md

## What This Is

ShowZo generates narrated walkthrough videos from a URL + natural language scenario description. It drives agent-browser to record screen interactions, then assembles the footage with TTS narration and cursor highlights.

## Repo Structure

| Path | Purpose |
|------|---------|
| `pipeline/` | Core recording/walkthrough/assembly scripts |
| `app/` | Web UI (Vite + React + Tailwind v4) |
| `api/` | Hono API server (proxies to pipeline) |
| `tests/` | Pipeline unit tests (63+ tests total across root + app) |
| `scripts/` | Helper scripts (cursor overlays, intro/outro generation) |
| `docs/` | Architecture docs |
| `.github/workflows/ci.yml` | CI: test, lint, build |

## Key Architecture Decisions

- **Two-pass recording**: Pass 1 drives agent-browser and captures raw footage + interaction log. Pass 2 uses pass 1 data to generate narration and assemble the final video.
- **LLM planner** (`pipeline/plan.ts`): Analyzes page via agent-browser, generates structured action plan + narrated scenes. Uses Zo's `/zo/ask` API for scene generation.
- **Web UI** (`app/`): Input form → plan review → record/assemble flow. Built with Vite + React + Tailwind. API server runs on Hono.
- **Cursor overlay**: post-processed via ffmpeg + Python scripts (`scripts/gen-cursor-overlay.py`).

## Dev Workflow

```bash
# Terminal 1: API server
bun run dev:api

# Terminal 2: Web UI dev server
cd app && bun x vite

# Run all tests
bun test

# Pipeline directly
bun run pipeline/plan.ts --url https://example.com --scenario "Show the login flow"
```

## Verifiability

- All pipeline modules export their core logic so it's importable/testable without CLI invocation.
- Unit tests live alongside their modules (`pipeline/*.test.ts` in `tests/`, `app/tests/` for UI).
- CI runs `bun test` at root (which auto-discovers and runs all test files).
- Each semantic change is a separate commit linked to an issue via `fixes #N` or `refs #N`.

## Hackathon Goals

1. **Core Pipeline** — working recording, narration, assembly
2. **Web UI** — URL + scenario input, plan review, record flow
3. **Dogfooding** — ShowZo recording its own walkthrough as the submission video
