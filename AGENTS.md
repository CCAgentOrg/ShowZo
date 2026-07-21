# ShowZo — Agentic Walkthrough Video Generator

**Mission:** Turn any URL + natural language scenario into a polished MP4 walkthrough — fully automated, fully agentic.

## Repo Structure

| Path | What |
|------|------|
| `pipeline/plan.ts` | Phase 1 — Page analysis + AI script generation |
| `pipeline/record.ts` | Phase 2 — agent-browser screen recording with interaction capture |
| `pipeline/assemble.ts` | Phase 3 — ffmpeg assembly: zoom, cursor overlay, TTS, captions, intro/outro |
| `pipeline/walkthrough.ts` | Main orchestrator — chains plan → record → assemble |
| `pipeline/integrate.ts` | End-to-end pipeline test runner |
| `pipeline/types.ts` | Shared type definitions (Step, Scene, ActionPlan, Session, etc.) |
| `scripts/gen-cursor-overlay.py` | Generates cursor PNG overlay image |
| `scripts/gen-intro-outro.py` | Generates intro/outro title cards |
| `app/` | Web UI (coming soon) |
| `tests/` | Unit + integration tests |
| `docs/ARCHITECTURE.md` | Full architecture doc |

## Core Design Principle: Verifiability

Every pipeline phase produces **verifiable artifacts**:
- **Plan phase** — output is validatable JSON with content hash
- **Record phase** — each step records `StepResult` with success/error/timestamp
- **Assemble phase** — final video probed (duration, resolution, codecs)

### Code conventions
- **Every I/O boundary validates.** Read a plan file? Validate its schema. Get a recording? Check duration. Assemble? Verify the output.
- **Fail early, fail loud.** Invalid input → descriptive error + non-zero exit. No silent fallbacks.
- **Deterministic assembly.** Same plan + same raw recording → same output. No random seeds.
- **Export pure functions for testing.** Pure logic (SRT generation, cursor math, time formatting) lives in exported functions, not embedded in side-effect-heavy code.

## Commands

```bash
# Full walkthrough
bun run pipeline/walkthrough.ts --url <URL> --scenario "<description>"

# Plan only (no recording)
bun run pipeline/walkthrough.ts --url <URL> --planOnly

# Re-record from existing plan
bun run pipeline/walkthrough.ts --planFile plan.json

# Assemble from existing recording + plan
bun run pipeline/assemble.ts --plan plan.json --video raw.mp4 --output final.mp4

# Integration test (real page, no mock)
bun run pipeline/integrate.ts <URL>

# Run unit tests
bun test

# Verify plan structure
bun run tests/verify.ts plan plan.json

# Verify output video
bun run tests/verify.ts video output.mp4

# Lint
bun run lint
```

## Tests

Key areas covered:
- **types.test.ts** — Schema validation for all data types
- **plan.test.ts** — Plan structure checks, hash verification, error detection
- **record.test.ts** — SRT generation, time formatting, interaction log parsing
- **assemble.test.ts** — Cursor math, zoom calculations, ffmpeg filter validation
- **integration/ (coming)** — Mocked full pipeline runs

Run with: `bun test` (supports `--watch`, `--coverage`)

## Design Decisions

| Decision | Rationale |
|----------|-----------|
| Two-pass recording (raw + overlay) | Preserves original interaction fidelity; overlays are applied in post so they can be tuned without re-recording |
| agent-browser for recording | Open-source, scriptable, works headless; avoids Selenium/Puppeteer weight |
| ffmpeg for assembly | Universal, powerful filter graph; no proprietary dependencies |
| Edge TTS for narration | Free, high-quality neural voices; no API key needed |
| Zo /ask API for planning | Leverages existing model access; keeps pipeline self-hosted |
