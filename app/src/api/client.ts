import type { PlanResponse, PlanRequest } from "../types";

/**
 * Thin fetch wrapper to the ShowZo API.
 * During dev (Vite <-> Hono on same host) use relative URLs so Vite's proxy
 * handles them. In production swap VITE_API_URL to the deployed backend.
 */
const BASE = import.meta.env.VITE_API_URL || "";

export async function fetchPlan(req: PlanRequest): Promise<PlanResponse> {
  const res = await fetch(`${BASE}/api/plan`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(req),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.error || `Server error: ${res.status}`);
  }
  return res.json();
}
