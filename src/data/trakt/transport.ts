import type { DispatchResult, RequestDescriptor } from "@domain/write-queue/types";
import type { TraktClient } from "./client";

/**
 * Bridge the pure write queue to the Trakt transport: a `RequestDescriptor`
 * becomes a raw `DispatchResult` for the queue to classify. A fetch reject
 * propagates as a throw — exactly the NetworkError the queue reconciles before
 * retry; every HTTP response (incl. 429/5xx) resolves so `classifyStatus`
 * can read its status + `Retry-After`.
 */
export function createTraktTransport(
  client: TraktClient,
): (request: RequestDescriptor) => Promise<DispatchResult> {
  return (request) => client.send(request.method, request.path, { body: request.body });
}
