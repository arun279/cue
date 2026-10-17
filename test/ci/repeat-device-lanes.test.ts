import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { repositoryPath } from "../support/repository-path";
import { readWorkflowJobs } from "../support/workflow-jobs";

const ci = readFileSync(repositoryPath(".github/workflows/ci.yml"), "utf8");
const repeat = readFileSync(repositoryPath(".github/workflows/repeat-device-lanes.yml"), "utf8");
const jobs = readWorkflowJobs(repositoryPath(".github/workflows/ci.yml"));
const deviceJobs = jobs.filter(({ body }) =>
  /scripts\/maestro-test\.sh --device|script: bash scripts\/verify-android-ui\.sh/.test(body),
);
const suffix = "$" + "{{ inputs.copy }}";

describe("device proof copies", () => {
  it("calls the same CI jobs at the pushed commit three times without cancelling copies", () => {
    expect(repeat).toContain('branches: ["proof/**"]');
    expect(repeat).not.toContain("workflow_dispatch");
    expect(repeat).toContain("uses: ./.github/workflows/ci.yml");
    expect(repeat).toContain("copy: [1, 2, 3]");
    expect(repeat).toContain("copy: -copy-$" + "{{ matrix.copy }}");
    expect(repeat).toContain("fail-fast: false");
    expect(repeat).not.toMatch(/concurrency:|max-parallel:|continue-on-error:|runs-on: macos/);
    expect(ci).toMatch(/workflow_call:\n {4}inputs:\n {6}copy:[\s\S]*?default: ""/);
    expect(ci).toContain("cancel-in-progress: $" + "{{ !inputs.copy }}");
    expect(ci).toContain("format('-{0}-{1}-{2}', github.run_id, github.run_attempt, inputs.copy)");
    for (const { body } of jobs) {
      expect(body).not.toContain("concurrency:");
      expect(body).not.toContain("fail-fast: true");
      expect(body).not.toMatch(/^ {10}ref:/m);
    }
  });

  it("keeps all device lanes enabled for proof pushes and skips unrelated checks", () => {
    expect(deviceJobs.map(({ name }) => name)).toEqual([
      "native-e2e-ios-light",
      "ui-screenshots-ios-dark",
      "android-e2e",
      "ui-screenshots-android-dark",
    ]);
    for (const { body } of deviceJobs) {
      expect(body.replaceAll(suffix, "")).not.toContain("inputs.copy");
    }
    expect(
      jobs
        .filter(({ body }) => body.includes("if: $" + "{{ !inputs.copy }}"))
        .map(({ name }) => name),
    ).toEqual(["check", "render-performance", "audit", "actionlint"]);
  });

  it("isolates every device artifact and downloads the matching copy's build", () => {
    const producers = jobs.filter(({ name }) =>
      ["native-ios", "native-android", ...deviceJobs.map((job) => job.name)].includes(name),
    );
    const uploads = producers.flatMap(({ body }) =>
      [...body.matchAll(/uses: actions\/upload-artifact@[^\n]+\n[\s\S]*?\n {10}name: (.+)/g)].map(
        ([, name = ""]) => name,
      ),
    );
    expect(uploads.length).toBeGreaterThan(0);
    for (const name of uploads) expect(name.endsWith(suffix)).toBe(true);
    const expanded = [1, 2, 3].flatMap((copy) =>
      uploads.flatMap((name) =>
        (name.includes("matrix.suite") ? ["detail", "activity", "discovery"] : [""]).map((suite) =>
          name.replace(suffix, `-copy-${copy}`).replace("$" + "{{ matrix.suite }}", suite),
        ),
      ),
    );
    expect(new Set(expanded).size).toBe(expanded.length);
    for (const { body } of deviceJobs) {
      const downloads = [
        ...body.matchAll(/uses: actions\/download-artifact@[^\n]+\n\s+with:\n\s+name: (.+)/g),
      ];
      expect(downloads).toHaveLength(1);
      for (const [, name] of downloads) expect(uploads).toContain(name);
    }
  });

  it("summarizes each copy's jobs from the current attempt even when a lane fails", () => {
    expect(repeat).toContain("if: $" + "{{ always() }}");
    expect(repeat).toContain("needs: devices");
    expect(repeat).toContain("gh api --paginate");
    expect(repeat).toContain("/attempts/$GITHUB_RUN_ATTEMPT/jobs?per_page=100");
    expect(repeat).toContain('startswith("devices (")');
    expect(repeat).toContain(".conclusion // .status");
    expect(repeat).toContain('>> "$GITHUB_STEP_SUMMARY"');
    expect(repeat).toContain("test '$" + "{{ needs.devices.result }}' = success");
  });
});
