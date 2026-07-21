import { $ } from "bun";
import type { ActionPlan, StepResult, InteractionEvent } from "./types";

interface RecordOptions {
  plan: ActionPlan;
  outputDir: string;
}

/**
 * Phase 2 — Execute the walkthrough steps on the page and record.
 * Uses agent-browser to navigate, interact, and capture a raw screen recording.
 */
export async function recordWalkthrough(opts: RecordOptions): Promise<{
  rawVideo: string;
  interactionLog: string;
  stepResults: StepResult[];
}> {
  const { plan, outputDir } = opts;
  const rawVideoPath = `${outputDir}/recording.webm`;
  const interactionLogPath = `${outputDir}/interactions.json`;
  const stepResults: StepResult[] = [];
  const sessionName = `showzo-${Date.now()}`;

  // Event capture script injected after page load
  const eventCaptureScript = `
    window.__showzo_events = [];
    const captureMove = (e) => {
      if (!window.__showzo_recording) return;
      const event = {
        type: 'mousemove',
        timestamp: performance.now(),
        data: { x: e.clientX, y: e.clientY }
      };
      window.__showzo_events.push(event);
    };
    const captureClick = (e) => {
      if (!window.__showzo_recording) return;
      window.__showzo_events.push({
        type: 'click',
        timestamp: performance.now(),
        data: {
          x: e.clientX,
          y: e.clientY,
          clickState: e.type === 'mousedown' ? 'down' : 'up'
        }
      });
    };
    const captureScroll = () => {
      if (!window.__showzo_recording) return;
      window.__showzo_events.push({
        type: 'scroll',
        timestamp: performance.now(),
        data: { scrollX: window.scrollX, scrollY: window.scrollY }
      });
    };
    document.addEventListener('mousemove', captureMove, { passive: true });
    document.addEventListener('mousedown', captureClick, { passive: true });
    document.addEventListener('mouseup', captureClick, { passive: true });
    document.addEventListener('scroll', captureScroll, { passive: true });
    window.__showzo_recording = true;
    console.log('[ShowZo] Event capture injected');
  `;

  const sessionFlag = `--session ${sessionName}`;

  try {
    // Phase 2a: Open the page + start recording simultaneously
    // record start opens the URL in a fresh recording context
    console.log(`  → Opening ${plan.url} and starting recording`);
    
    await $`agent-browser ${sessionFlag} record start ${rawVideoPath} ${plan.url}`.quiet();
    
    // Wait for page to stabilize
    await new Promise(r => setTimeout(r, 2000));

    // Inject event capture
    await $`agent-browser ${sessionFlag} eval ${eventCaptureScript}`.quiet().catch(() => {
      // eval might not return directly; try via string injection
      return $`agent-browser ${sessionFlag} eval 'window.__showzo_recording = true; document.addEventListener("mousemove", (e) => { if(window.__showzo_recording){ window.__showzo_events = window.__showzo_events || []; window.__showzo_events.push({type:"mousemove",timestamp:performance.now(),data:{x:e.clientX,y:e.clientY}});} }, {passive:true})'`.quiet();
    });

    console.log(`  → Executing ${plan.steps.length} steps`);

    // Execute each step
    for (const step of plan.steps) {
      const startTs = performance.now();
      const label = `    [${step.order}/${plan.steps.length}] ${step.action}${step.target ? " " + step.target : ""}`;
      process.stdout.write(label);

      try {
        switch (step.action) {
          case "click": {
            if (step.target?.startsWith("@")) {
              await $`agent-browser ${sessionFlag} click ${step.target}`.quiet();
            } else if (step.target) {
              await $`agent-browser ${sessionFlag} click "${step.target}"`.quiet();
            } else {
              await $`agent-browser ${sessionFlag} click`.quiet();
            }
            break;
          }
          case "type":
            await $`agent-browser ${sessionFlag} type "${step.target}" "${step.value}"`.quiet();
            break;
          case "scroll":
            await $`agent-browser ${sessionFlag} scroll 0 ${step.value ?? "500"}`.quiet();
            break;
          case "wait":
            await new Promise(r => setTimeout(r, step.pauseMs ?? 2000));
            break;
          case "hover":
            await $`agent-browser ${sessionFlag} hover ${step.target}`.quiet();
            break;
          case "screenshot":
            await $`agent-browser ${sessionFlag} screenshot ${outputDir}/step-${step.order}.png`.quiet();
            break;
          default:
            console.warn(`    ⚠ Unknown action: ${step.action}`);
        }
        console.log(` ✓`);
        stepResults.push({
          stepId: step.id,
          success: true,
          timestamp: performance.now() - startTs,
        });
      } catch (e) {
        console.log(` ✗`);
        console.error(`    Error: ${e instanceof Error ? e.message : e}`);
        stepResults.push({
          stepId: step.id,
          success: false,
          error: e instanceof Error ? e.message : String(e),
          timestamp: performance.now() - startTs,
        });
      }

      // Brief pause between steps for visual clarity
      await new Promise(r => setTimeout(r, step.pauseMs ?? 800));
    }

    // Wait for last frame
    await new Promise(r => setTimeout(r, 1000));

    // Stop recording
    await $`agent-browser ${sessionFlag} record stop`.quiet();
    console.log(`  → Recording saved to ${rawVideoPath}`);

    // Extract interaction events
    const eventsJson = await $`agent-browser ${sessionFlag} eval 'JSON.stringify((window.__showzo_events || []).slice(0, 2000))'`.text();
    const events: InteractionEvent[] = JSON.parse(eventsJson.trim());
    Bun.write(interactionLogPath, JSON.stringify(events, null, 2));
    console.log(`  → ${events.length} interaction events logged`);

    return { rawVideo: rawVideoPath, interactionLog: interactionLogPath, stepResults };
  } catch (e) {
    // Ensure recording stops
    await $`agent-browser ${sessionFlag} record stop`.quiet().catch(() => {});
    throw new Error(`Recording failed: ${e instanceof Error ? e.message : e}`);
  }
}

/**
 * Generate SRT captions from narration scenes with timing
 */
export function generateCaptions(
  scenes: { narration: string; duration: number; order: number }[],
): string {
  let currentTime = 0;
  const lines: string[] = [];
  let seq = 1;

  for (const scene of scenes) {
    if (!scene.narration.trim()) {
      currentTime += scene.duration;
      continue;
    }
    
    const words = scene.narration.split(/\s+/);
    const wordsPerSub = Math.max(3, Math.ceil(words.length / (scene.duration / 2.5)));
    let chunk: string[] = [];
    let chunkStart = currentTime;
    const secsPerWord = scene.duration / Math.max(words.length, 1);

    for (const word of words) {
      chunk.push(word);
      const chunkLen = chunk.join(" ").length;
      const elapsed = chunk.length * secsPerWord;
      if (chunkLen > 40 || elapsed >= 2.5) {
        const chunkEnd = chunkStart + chunk.length * secsPerWord;
        if (chunkEnd > chunkStart) {
          lines.push(String(seq++));
          lines.push(formatSrtTime(chunkStart) + " --> " + formatSrtTime(Math.min(chunkEnd, currentTime + scene.duration)));
          lines.push(chunk.join(" "));
          lines.push("");
        }
        chunkStart = chunkStart + chunk.length * secsPerWord;
        chunk = [];
      }
    }
    if (chunk.length > 0) {
      const chunkEnd = chunkStart + chunk.length * secsPerWord;
      if (chunkEnd > chunkStart) {
        lines.push(String(seq++));
        lines.push(formatSrtTime(chunkStart) + " --> " + formatSrtTime(Math.min(chunkEnd, currentTime + scene.duration)));
        lines.push(chunk.join(" "));
        lines.push("");
      }
    }
    currentTime += scene.duration;
  }
  return lines.join("\n");
}

function formatSrtTime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  const ms = Math.floor((seconds % 1) * 1000);
  return `${pad(h)}:${pad(m)}:${pad(s)},${String(ms).padStart(3, "0")}`;
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}
