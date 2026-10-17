import { z } from "zod";
import type { ReadProblem } from "./client";

type ProblemKind = ReadProblem["kind"];

export interface ReadIncident {
  readonly endpoint: string;
  readonly kind: ProblemKind;
  readonly detail: string;
  readonly at: number;
}

export const PROBLEM_LABELS: Readonly<Record<ProblemKind, string>> = {
  "unexpected-shape": "Unreadable shape",
  "skipped-fields": "Skipped fields",
  "no-content": "Empty reply",
  timeout: "Timed out",
  network: "Offline or unreachable",
  "rate-limited": "Rate limited",
  server: "Server error",
  "unreadable-response": "Blocked reply",
  unauthorized: "Session expired",
  "not-found": "Not found",
  "account-limit": "Account limit",
  "account-locked": "Account locked",
  "vip-required": "VIP required",
};

function describe(problem: ReadProblem): string {
  switch (problem.kind) {
    case "unexpected-shape":
    case "skipped-fields":
      return problem.issues.map((issue) => `${issue.path}: ${issue.message}`).join("; ");
    case "server":
      return `HTTP ${problem.status}`;
    case "rate-limited":
      return problem.retryAfterMs === null ? "" : `retry after ${problem.retryAfterMs} ms`;
    default:
      return "";
  }
}

export function recordIncident(
  incidents: readonly ReadIncident[],
  endpoint: string,
  problem: ReadProblem,
  at: number,
): readonly ReadIncident[] {
  const incident = { endpoint, kind: problem.kind, detail: describe(problem), at };
  return [incident, ...incidents.filter((entry) => entry.endpoint !== endpoint)];
}

export function incidentReport(incidents: readonly ReadIncident[], version: string): string {
  const lines = incidents.map((incident) =>
    [new Date(incident.at).toISOString(), incident.endpoint, incident.kind, incident.detail]
      .filter((part) => part !== "")
      .join("  "),
  );
  return [`Cue ${version} Trakt diagnostics`, ...(lines.length > 0 ? lines : ["No errors"])].join(
    "\n",
  );
}

const incidentsSchema = z.array(
  z.object({
    endpoint: z.string(),
    kind: z.custom<ProblemKind>(
      (value) => typeof value === "string" && Object.hasOwn(PROBLEM_LABELS, value),
    ),
    detail: z.string(),
    at: z.number(),
  }),
);

export function parseIncidents(value: unknown): readonly ReadIncident[] {
  return incidentsSchema.catch([]).parse(value);
}
