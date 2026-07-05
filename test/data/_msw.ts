import { type SetupServer, setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll } from "vitest";

/**
 * Register a hermetic MSW server for a suite: no request escapes to the real
 * network (`onUnhandledRequest: "error"`), and handlers reset between tests.
 */
export function mswServer(): SetupServer {
  const server = setupServer();
  beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
  afterEach(() => server.resetHandlers());
  afterAll(() => server.close());
  return server;
}
