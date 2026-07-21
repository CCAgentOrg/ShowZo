/**
 * Verify the app builds without errors.
 */

import { describe, it, expect } from "bun:test";
import { execSync } from "child_process";
import { join } from "path";

describe("Vite build", () => {
  it(
    "completes without errors",
    async () => {
      const appDir = join(import.meta.dir, "..");
      const result = execSync(`cd "${appDir}" && bun x vite build 2>&1`, {
        encoding: "utf-8",
        timeout: 120_000,
      });
      expect(result).toMatch(/built in/);
      expect(result).not.toMatch(/error/i);
    },
    120_000,
  );
});
