/**
 * The fake over HTTP, for the smoke flows on a simulator or emulator:
 * `node packages/core/test/trakt-fake/serve.ts`. The account's clock starts at
 * `FIXTURE_NOW` and runs on, as the app's does in a smoke build. Two controls sit
 * beside the Trakt routes: `POST /__approve` enters the device code, and
 * `POST /__reset` puts the account back. Artwork points here, at placeholder
 * images, so screenshots show posters without reaching Trakt's image host.
 */

import { readFileSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { getResponse } from "msw";
import { FIXTURE_NOW } from "./account.ts";
import { createTraktFake } from "./fake.ts";

const ORIGIN = "http://127.0.0.1:8787";
const started = Date.now();
const fake = createTraktFake({
  baseUrl: ORIGIN,
  clock: () => FIXTURE_NOW + Date.now() - started,
  art: (kind, id, slot) => `${ORIGIN}/images/${kind}/${id}/${slot}.png`,
});
const image = (slot: string) => readFileSync(new URL(`${slot}.png`, import.meta.url));
const IMAGES = new Map(["poster", "fanart", "avatar"].map((slot) => [slot, image(slot)]));
const CONTROLS: Readonly<Record<string, () => void>> = {
  "/__approve": fake.approve,
  "/__reset": fake.reset,
};

async function bodyOf(request: IncomingMessage): Promise<Buffer | undefined> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(chunk as Buffer);
  return chunks.length === 0 ? undefined : Buffer.concat(chunks);
}

/** The two controls and the placeholder images; false when the request is for Trakt. */
function local(request: IncomingMessage, url: URL, response: ServerResponse): boolean {
  const control = request.method === "POST" ? CONTROLS[url.pathname] : undefined;
  const slot = /^\/images\/[^/]+\/\d+\/(\w+)\.png$/.exec(url.pathname)?.[1];
  if (control === undefined && slot === undefined) return false;
  control?.();
  response.writeHead(200, slot === undefined ? {} : { "content-type": "image/png" });
  response.end(slot === undefined ? "" : (IMAGES.get(slot) ?? IMAGES.get("fanart")));
  return true;
}

async function toRequest(request: IncomingMessage, url: URL): Promise<Request> {
  const body = await bodyOf(request);
  const headers = new Headers();
  for (const [name, value] of Object.entries(request.headers)) {
    if (typeof value === "string") headers.set(name, value);
  }
  const method = request.method ?? "GET";
  return new Request(url, {
    method,
    headers,
    ...(body === undefined ? {} : { body: new Uint8Array(body) }),
  });
}

async function answer(request: IncomingMessage, response: ServerResponse): Promise<void> {
  const url = new URL(request.url ?? "/", ORIGIN);
  if (local(request, url, response)) return;
  const answered = await getResponse([...fake.handlers], await toRequest(request, url));
  const line = `${request.method} ${url.pathname}${url.search}`;
  if (answered === undefined) {
    process.stdout.write(`${line} has no route\n`);
    response.writeHead(404).end();
    return;
  }
  process.stdout.write(`${line} ${answered.status}\n`);
  if (answered.type === "error") {
    request.socket.destroy();
    return;
  }
  response.writeHead(answered.status, Object.fromEntries(answered.headers));
  response.end(Buffer.from(await answered.arrayBuffer()));
}

createServer((request, response) => void answer(request, response)).listen(8787, "127.0.0.1", () =>
  process.stdout.write(`fake Trakt on ${ORIGIN}\n`),
);
