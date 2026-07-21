#!/usr/bin/env bun
/**
 * walkthrough.ts — Main orchestrator for ShowZo
 *
 * Chains: plan → record → assemble
 * Usage: bun run pipeline/walkthrough.ts --url <URL> --scenario <DESC> [--output <DIR>]
 */

import { parseArgs } from "util";
import { stat } from "node:fs/promises";
import { generatePlan } from "./plan";
import { recordWalkthrough } from "./record";
import { assembleVideo } from "./assemble";
import type { WalkthroughPlan } from "./types";

const args = parseArgs({
  args: Bun.argv.slice(2),
  options: {
    url: { type: "string", short: "u" },
    scenario: { type: "string", short: "s" },
    output: { type: "string", short: "o", default: "/tmp/showzo-output" },
    planOnly: { type: "boolean", default: false },
    skipPlan: { type: "boolean", default: false },
    planFile: { type: "string" },
    help: { type: "boolean", short: "h" },
  },
});

if (args.values.help || (!args.values.url && !args.values.planFile)) {
  console.log(`
ShowZo — Agentic walkthrough video generator

Usage:
  bun run pipeline/walkthrough.ts --url <URL> --scenario <DESC>
  bun run pipeline/walkthrough.ts --planFile plan.json

Options:
  -u, --url        Target URL to record
  -s, --scenario   Natural language description of the walkthrough
  -o, --output     Output directory (default: /tmp/showzo-output)
  --planOnly       Generate plan and exit (don't record)
  --planFile       Skip planning, use existing plan JSON
  -h, --help       Show this help
`);
  process.exit(0);
}

async function main() {
  const config = {
    url: args.values.url!,
    scenario: args.values.scenario ?? "Show me how to use this website",
    outputDir: args.values.output!,
  };

  await Bun.write(`${config.outputDir}/.gitkeep`, "");
  console.log(`\n🎬 ShowZo — ${config.url}`);

  // Phase 1: Plan
  let plan: WalkthroughPlan;
  if (args.values.planFile) {
    const raw = await Bun.file(args.values.planFile).text();
    plan = JSON.parse(raw);
    console.log(`📋 Loaded plan from ${args.values.planFile} (${plan.steps.length} steps)`);
  } else {
    console.log(`\n🔮 Phase 1/3: Generating action plan...`);
    plan = await generatePlan(config.url, config.scenario);
    await Bun.write(`${config.outputDir}/plan.json`, JSON.stringify(plan, null, 2));
    console.log(`📋 Plan: ${plan.title} — ${plan.steps.length} steps`);
    plan.steps.forEach((s, i) => console.log(`   ${i + 1}. ${s.description}`));
    if (args.values.planOnly) {
      console.log(`\n✅ Plan written to ${config.outputDir}/plan.json`);
      process.exit(0);
    }
  }

  // Phase 2: Record
  console.log(`\n🎥 Phase 2/3: Recording ${plan.steps.length} steps...`);
  const recordingPath = await recordWalkthrough(plan, config.outputDir);

  // Phase 3: Assemble
  console.log(`\n🎞️ Phase 3/3: Generating narration + assembling video...`);
  const outputPath = await assembleVideo(plan, recordingPath, config.outputDir);

  // Summary
  const stats = await stat(outputPath);
  console.log(`\n✅ Done!`);
  console.log(`   📹 ${outputPath}`);
  console.log(`   📏 ${(stats.size / 1024 / 1024).toFixed(1)} MB`);
}

main().catch((e) => {
  console.error(`\n❌ ${e.message}`);
  process.exit(1);
});
