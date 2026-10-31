import { describe, expect, it } from "vitest";
import { incidentReport, parseIncidents, recordIncident } from "@/core/domain/diagnostics";

describe("read incidents", () => {
  it("keeps the latest problem per endpoint, newest first", () => {
    const first = recordIncident([], "/users/settings", { kind: "timeout" }, 1);
    const second = recordIncident(first, "/sync/watched/shows", { kind: "network" }, 2);
    const third = recordIncident(second, "/users/settings", { kind: "server", status: 503 }, 3);
    expect(third).toEqual([
      { endpoint: "/users/settings", kind: "server", detail: "HTTP 503", at: 3 },
      { endpoint: "/sync/watched/shows", kind: "network", detail: "", at: 2 },
    ]);
  });

  it("writes a plain-text report of endpoint, kind and detail only", () => {
    const incidents = recordIncident(
      [],
      "/users/settings",
      { kind: "unexpected-shape", issues: [{ path: "episodes.minutes", message: "bad" }] },
      Date.UTC(2026, 9, 3, 22, 14),
    );
    expect(incidentReport(incidents, "1.4.0 (2101)")).toBe(
      [
        "Cue 1.4.0 (2101) diagnostics",
        "2026-10-03T22:14:00.000Z  /users/settings  unexpected-shape  episodes.minutes: bad",
      ].join("\n"),
    );
  });

  it("details a rate limit by its Retry-After when Trakt sends one", () => {
    const limited = recordIncident([], "/a", { kind: "rate-limited", retryAfterMs: 2000 }, 1);
    const unbounded = recordIncident([], "/b", { kind: "rate-limited", retryAfterMs: null }, 1);
    expect(limited[0]?.detail).toBe("retry after 2000 ms");
    expect(unbounded[0]?.detail).toBe("");
  });

  it("says so when there is nothing to report", () => {
    expect(incidentReport([], "1.4.0 (2101)")).toBe("Cue 1.4.0 (2101) diagnostics\nNo errors");
  });

  it("reports a failed start first, with the error it failed on", () => {
    const incidents = recordIncident([], "/sync/watched", { kind: "timeout" }, 2);
    const start = { at: Date.UTC(2026, 9, 3, 22, 14), detail: "Error: database is locked" };

    expect(incidentReport(incidents, "1.4.0 (2101)", start)).toBe(
      [
        "Cue 1.4.0 (2101) diagnostics",
        "2026-10-03T22:14:00.000Z  start  Error: database is locked",
        "1970-01-01T00:00:00.002Z  /sync/watched  timeout",
      ].join("\n"),
    );
  });

  it("reads back only well-formed persisted incidents", () => {
    const stored = [{ endpoint: "/users/settings", kind: "no-content", detail: "", at: 5 }];
    expect(parseIncidents(stored)).toEqual(stored);
    expect(parseIncidents([{ ...stored[0], kind: "made-up" }])).toEqual([]);
  });
});
