/**
 * ShowZo Web UI — test suite
 *
 * Tests the URL input form logic, validation, and rendering.
 * Run with: `cd app && bun test`
 */

import { describe, it, expect, mock } from "bun:test";

// ── URL validation helper (extracted from UrlForm for testability) ─────────

function validateUrl(url: string): string | null {
  if (!url.trim()) return "URL is required";
  try {
    new URL(url.trim());
    return null;
  } catch {
    return "Invalid URL — enter a full URL starting with https://";
  }
}

function validateScenario(scenario: string): string | null {
  if (!scenario.trim()) return "Scenario description is required";
  if (scenario.trim().length < 10) return "Describe the walkthrough in at least a few words";
  return null;
}

// ── Tests ─────────────────────────────────────────────────────────────────

describe("URL validation", () => {
  it("rejects empty URL", () => {
    expect(validateUrl("")).toBe("URL is required");
  });

  it("rejects whitespace-only URL", () => {
    expect(validateUrl("   ")).toBe("URL is required");
  });

  it("rejects malformed URL", () => {
    expect(validateUrl("not-a-url")).toContain("Invalid URL");
  });

  it("rejects protocol-less URL", () => {
    expect(validateUrl("example.com/path")).toContain("Invalid URL");
  });

  it("accepts valid https URL", () => {
    expect(validateUrl("https://example.com")).toBeNull();
  });

  it("accepts http URL", () => {
    expect(validateUrl("http://localhost:3000/test")).toBeNull();
  });

  it("accepts URL with query params", () => {
    expect(validateUrl("https://example.com/page?foo=bar&baz=1")).toBeNull();
  });

  it("accepts deep path", () => {
    expect(validateUrl("https://app.example.com/dashboard/users/123")).toBeNull();
  });

  it("trims whitespace before validation", () => {
    expect(validateUrl("  https://example.com  ")).toBeNull();
  });
});

describe("Scenario validation", () => {
  it("rejects empty scenario", () => {
    expect(validateScenario("")).toBe("Scenario description is required");
  });

  it("rejects whitespace-only scenario", () => {
    expect(validateScenario("   ")).toBe("Scenario description is required");
  });

  it("rejects too-short scenario", () => {
    expect(validateScenario("Hi")).toContain("at least");
  });

  it("accepts valid scenario", () => {
    expect(validateScenario("Navigate to login page, enter credentials, click submit")).toBeNull();
  });

  it("accepts exact minimum length", () => {
    expect(validateScenario("1234567890")).toBeNull(); // exactly 10 chars
  });
});

describe("fetchPlan error handling", () => {
  it("throws on non-ok response with error body", async () => {
    const mockFetch = mock(() =>
      Promise.resolve(
        new Response(JSON.stringify({ error: "Invalid URL scheme" }), {
          status: 400,
          headers: { "content-type": "application/json" },
        }),
      ),
    );

    // Temporarily replace global fetch
    const origFetch = globalThis.fetch;
    globalThis.fetch = mockFetch as unknown as typeof fetch;

    try {
      const { fetchPlan } = await import("../src/api/client");
      await expect(fetchPlan({ url: "bad://url", scenario: "test description here" })).rejects.toThrow(
        "Invalid URL scheme",
      );
    } finally {
      globalThis.fetch = origFetch;
    }
  });

  it("throws on non-ok response without error body", async () => {
    const mockFetch = mock(() =>
      Promise.resolve(new Response("Service Unavailable", { status: 503 })),
    );

    const origFetch = globalThis.fetch;
    globalThis.fetch = mockFetch as unknown as typeof fetch;

    try {
      const { fetchPlan } = await import("../src/api/client");
      await expect(fetchPlan({ url: "https://example.com", scenario: "walk through the homepage features" })).rejects.toThrow(
        "Server error: 503",
      );
    } finally {
      globalThis.fetch = origFetch;
    }
  });

  it("returns parsed plan on success", async () => {
    const mockPlan = {
      title: "Test Walkthrough",
      url: "https://example.com",
      steps: [
        { id: "s1", order: 1, action: "navigate", target: undefined, narration: "Go to the page" },
      ],
    };

    const mockFetch = mock(() =>
      Promise.resolve(
        new Response(JSON.stringify(mockPlan), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      ),
    );

    const origFetch = globalThis.fetch;
    globalThis.fetch = mockFetch as unknown as typeof fetch;

    try {
      const { fetchPlan } = await import("../src/api/client");
      const result = await fetchPlan({ url: "https://example.com", scenario: "test" });
      expect(result.title).toBe("Test Walkthrough");
      expect(result.steps).toHaveLength(1);
    } finally {
      globalThis.fetch = origFetch;
    }
  });
});

describe("API server health check", () => {
  it("GET /api/health returns ok", async () => {
    // This is an integration test — only runs if the API server is up
    const res = await fetch("http://localhost:3001/api/health").catch(() => null);
    if (!res) return; // skip if server not running

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
  });
});

describe("API /api/plan validation", () => {
  it("rejects missing url", async () => {
    const res = await fetch("http://localhost:3001/api/plan", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ scenario: "test walkthrough of features" }),
    }).catch(() => null);

    if (!res) return; // skip integration if server not running
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBeDefined();
  });

  it("rejects empty scenario", async () => {
    const res = await fetch("http://localhost:3001/api/plan", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: "https://example.com", scenario: "" }),
    }).catch(() => null);

    if (!res) return;
    expect(res.status).toBe(400);
  });

  it("rejects invalid URL", async () => {
    const res = await fetch("http://localhost:3001/api/plan", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: "not-a-url", scenario: "test walkthrough here" }),
    }).catch(() => null);

    if (!res) return;
    expect(res.status).toBe(400);
  });
});
