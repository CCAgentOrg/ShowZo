#!/bin/bash
set -e
REPO="CCAgentOrg/ShowZo"

# Milestone 1: Foundation — Day 1

gh issue create -R "$REPO" \
  --label "stream:orchestrator" --label "priority:critical" \
  --title "Scaffold monorepo structure" \
  --body 'Create the repo layout:
```
showzo/
├── app/           — Web UI (zo.space routes)
├── pipeline/      — Recording pipeline
├── shared/        — Types, configs
├── scripts/       — Dev utilities
└── docs/          — Architecture
```
- TypeScript + Bun everywhere
- tsconfig, shared types in shared/types.ts' 2>&1

gh issue create -R "$REPO" \
  --label "stream:pipeline" --label "priority:critical" \
  --title "Port walkthrough pipeline into ShowZo repo" \
  --body 'Copy and refine the working pipeline from Skills/zo-walkthrough-video/ into pipeline/:
- Phase 1: Research/plan generation (LLM)
- Phase 2: agent-browser screen recording + page analysis
- Phase 3: TTS narration (edge-tts)
- Phase 4: ffmpeg assembly (overlay narration on recording)
- Phase 5: Output MP4

Add proper error handling, timeouts, progress callbacks.' 2>&1

gh issue create -R "$REPO" \
  --label "stream:pipeline" --label "priority:critical" \
  --title "LLM plan generator: scenario -> action steps" \
  --body 'Given a URL + natural language scenario ("Show me how to create a new repo in GitHub"), produce structured ActionStep[]:
```ts
type ActionStep = {
  id: string;
  instruction: string;       // What to do
  narration: string;         // What to say
  element_hint?: string;     // "Click the green button labeled Create"
  wait_after_ms?: number;    // Pause after this step
  scroll_to?: string;        // Element to scroll into view
  type_text?: string;        // Text to type
  url_target?: string;       // Navigate to this URL first
};
```
Use Zo /ask API to parse. Return JSON array validated against schema.' 2>&1

gh issue create -R "$REPO" \
  --label "stream:ui" --label "priority:critical" \
  --title "Web UI: URL + scenario input form" \
  --body 'Build a clean step 1 form:
- URL input field
- Scenario textarea (natural language description)
- "Generate Plan" button
- Loading state while LLM generates

Keep it one-screen, focused. Style with Tailwind.' 2>&1

gh issue create -R "$REPO" \
  --label "stream:ui" --label "priority:critical" \
  --title "Web UI: Plan review screen" \
  --body 'After LLM generates the plan, show:
- Step-by-step preview cards (scroll to, click, type, narrate)
- "Edit step" inline text fields
- "Re-order" drag handle
- "Remove step" button
- "Start Recording" button
- Visual timeline showing estimated duration' 2>&1

gh issue create -R "$REPO" \
  --label "stream:orchestrator" --label "priority:critical" \
  --title "API route: trigger recording from plan" \
  --body 'POST /api/record endpoint:
- Accept validated plan JSON
- Spawn pipeline as subprocess
- Return recording_id immediately
- Pipeline writes status to a status file
- GET /api/status/:id reads status file (progress %, current step, errors)' 2>&1

gh issue create -R "$REPO" \
  --label "stream:ui" --label "priority:high" \
  --title "Web UI: Recording progress view" \
  --body 'During recording, show:
- Live step tracker (which step, spinning indicator)
- Elapsed time
- Narration audio waveform (visual)
- Cancel button
- Compact log output for debugging' 2>&1

# Milestone 2: Usable Product — Day 2

gh issue create -R "$REPO" \
  --label "stream:ui" --label "priority:high" \
  --title "Web UI: Video preview + download" \
  --body 'After recording completes:
- Inline <video> player with playback
- Step list with timestamps (clickable to jump)
- Download MP4 button
- "Record Again" button
- Share link copy button' 2>&1

gh issue create -R "$REPO" \
  --label "stream:pipeline" --label "priority:high" \
  --title "Fallback: screenshot-snapshot mode" \
  --body 'agent-browser record can fail silently. Implement DOM screenshot capture at each step as fallback:
- Capture page screenshot via CDP (Page.captureScreenshot)
- Stitch into video with ffmpeg slideshow
- Add dissolve transitions between screenshots
- Detect recording failure and auto-fallback' 2>&1

gh issue create -R "$REPO" \
  --label "stream:pipeline" --label "priority:high" \
  --title "Pipeline timeout and retry" \
  --body 'If a step fails (page load timeout, element not found):
- Retry once with 3s wait
- If retry fails, skip step and log warning
- Never hang indefinitely — hard timeout per step (30s)
- Pipeline must produce output even with skipped steps' 2>&1

gh issue create -R "$REPO" \
  --label "stream:pipeline" --label "priority:high" \
  --title "Cursor highlight overlay" \
  --body 'During recording, inject a cursor highlight element:
- Small ring that follows mouse/focus position
- Pulsing animation on click
- Removed from final recording via compositing or injected CSS
- Makes walkthroughs dramatically clearer' 2>&1

gh issue create -R "$REPO" \
  --label "stream:orchestrator" --label "priority:high" \
  --title "Deploy web UI as a Zo Site" \
  --body 'Use create_website to scaffold a ShowZo React site. Publish as public service.
- Custom domain: showzo.cashlessconsumer.in (or zo.space subpath)
- Production build in CI
- Pipeline runs on backend Zo server' 2>&1

gh issue create -R "$REPO" \
  --label "stream:orchestrator" --label "priority:high" \
  --title "Integrate Zo /ask API for LLM calls" \
  --body 'Pipeline needs Zo /ask API for:
1. Scenario -> action steps generation
2. Narration script refinement (tone, concision)
3. Error recovery suggestions

Set up ZO_API_KEY secret in Zo settings, use fetch("https://api.zo.computer/zo/ask") with bearer token.' 2>&1

gh issue create -R "$REPO" \
  --label "stream:ui" --label "enhancement" \
  --title "UI: Dark mode" \
  --body 'Full dark mode with Tailwind dark: classes. System preference detection + manual toggle. Consistent with Zo platform theme.' 2>&1

# Milestone 3: Polish + Submission — Day 3

gh issue create -R "$REPO" \
  --label "submission" --label "priority:high" \
  --title "Write comprehensive README" \
  --body 'README should cover:
- What ShowZo is (one-liner)
- Architecture diagram (D2 or Mermaid)
- How it works (screenshots + flow)
- Quick start: one command to deploy
- Technologies: agent-browser, Zo, ffmpeg, edge-tts
- Link to live demo + demo video
- Hackathon context (Zo Ambassador Challenge)' 2>&1

gh issue create -R "$REPO" \
  --label "submission" --label "priority:high" \
  --title "Record ShowZo dogfood demo video" \
  --body 'Use ShowZo to record a walkthrough of itself:
1. Open ShowZo UI
2. Enter "bankin-report.cashlessconsumer.in" as URL
3. Describe "Show me the security findings report"
4. Review generated plan
5. Start recording
6. Download result

This is the meta pitch — dogfooding is the strongest demo.' 2>&1

gh issue create -R "$REPO" \
  --label "submission" \
  --title "Hackathon submission writeup" \
  --body 'Write the submission document:
- Problem: Making software walkthroughs is manual and expensive
- Solution: ShowZo — AI agent records + narrates walks through in one pass
- Key differentiator: Fully open-source, runs on your own Zo Computer, no SaaS subscription
- Demo video embedded
- Architecture: Zo Space UI -> Zo /ask API + agent-browser + ffmpeg
- What makes it Zo-native: Uses agent-browser (built-in), Zo /ask for LLM, Zo Site for hosting' 2>&1

gh issue create -R "$REPO" \
  --label "enhancement" \
  --title "CI: GitHub Actions for lint + build check" \
  --body 'Basic CI workflow:
- bun install + bun run check (TypeScript check)
- bun run build on push to main
- Optional: deploy to Zo via webhook' 2>&1

echo "=== All issues created ==="
