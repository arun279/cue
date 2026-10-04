import type { DispatchResult, RequestDescriptor } from "../../domain/write-queue/types";
import type { TraktClient } from "./client";

export function createTraktTransport(
  client: TraktClient,
): (request: RequestDescriptor) => Promise<DispatchResult> {
  return (request) => client.send(request.method, request.path, { body: request.body });
}
