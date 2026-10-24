import { setupServer } from "msw/node";
import { afterAll, beforeAll, beforeEach } from "vitest";
import { createTraktFake, type FakeOptions, type TraktFake } from "./fake.ts";

/**
 * The fake for one test file: every request to Trakt reaches it or fails the
 * test, and each test starts from a fresh account and session.
 */
export function startTraktFake(options: FakeOptions = {}): TraktFake {
  const fake = createTraktFake(options);
  const server = setupServer(...fake.handlers);
  beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
  beforeEach(() => fake.reset());
  afterAll(() => server.close());
  return fake;
}
