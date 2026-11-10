import { act } from "@testing-library/react";
import { vi } from "vitest";

/** Runs `action` while the queue's waits and pacing pass, as they would for a person waiting. */
export async function waited(action: () => Promise<unknown>): Promise<void> {
  await act(async () => {
    const running = action();
    await vi.advanceTimersByTimeAsync(15_000);
    await running;
  });
}
