import { describe, expect, it, vi } from "vitest";
import { withDeadline } from "@/core/domain/abortable";

describe("withDeadline", () => {
  it("never starts a request once its scope has ended", async () => {
    const scope = new AbortController();
    scope.abort();
    const request = vi.fn(() => Promise.resolve("answer"));

    await expect(withDeadline(1000, scope.signal, request)).rejects.toThrow();
    expect(request).not.toHaveBeenCalled();
  });

  it("discards an answer that arrives after its scope ended", async () => {
    const scope = new AbortController();
    let answer: (value: string) => void = () => {};
    const settled = withDeadline(
      1000,
      scope.signal,
      () => new Promise<string>((resolve) => (answer = resolve)),
    );

    scope.abort();
    answer("late");

    await expect(settled).rejects.toThrow();
  });
});
