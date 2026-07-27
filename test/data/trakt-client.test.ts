import { TRAKT_API_BASE, TraktClient } from "@data/trakt/client";
import { HttpResponse, http } from "msw";
import { describe, expect, it } from "vitest";
import { mswServer } from "./_msw";

const server = mswServer();

function client(token: string | null = null): TraktClient {
  return new TraktClient({ clientId: "cid-123", getToken: () => token });
}

describe("TraktClient headers + extended", () => {
  it("sets the required Trakt headers and omits Authorization when no token", async () => {
    let captured: Headers | undefined;
    server.use(
      http.get(`${TRAKT_API_BASE}/sync/watched/shows`, ({ request }) => {
        captured = request.headers;
        return HttpResponse.json([]);
      }),
    );
    await client().get("/sync/watched/shows");
    expect(captured?.get("trakt-api-key")).toBe("cid-123");
    expect(captured?.get("trakt-api-version")).toBe("2");
    expect(captured?.get("content-type")).toBe("application/json");
    expect(captured?.get("authorization")).toBeNull();
  });

  it("adds a bearer Authorization header when a token is present", async () => {
    let captured: Headers | undefined;
    server.use(
      http.get(`${TRAKT_API_BASE}/users/me`, ({ request }) => {
        captured = request.headers;
        return HttpResponse.json({});
      }),
    );
    await client("tok-abc").get("/users/me");
    expect(captured?.get("authorization")).toBe("Bearer tok-abc");
  });

  it("builds the comma-combined extended query param", async () => {
    let url: string | undefined;
    server.use(
      http.get(`${TRAKT_API_BASE}/shows/1/seasons`, ({ request }) => {
        url = request.url;
        return HttpResponse.json([]);
      }),
    );
    await client().get("/shows/1/seasons", { extended: ["full", "images"] });
    expect(new URL(url ?? "").searchParams.get("extended")).toBe("full,images");
  });
});

describe("TraktClient pagination", () => {
  const pageHeaders = (page: number, pageCount: number): Record<string, string> => ({
    "X-Pagination-Page": String(page),
    "X-Pagination-Limit": "10",
    "X-Pagination-Page-Count": String(pageCount),
    "X-Pagination-Item-Count": "25",
  });

  it("reads the X-Pagination-* headers into the result", async () => {
    server.use(
      http.get(`${TRAKT_API_BASE}/sync/history`, () =>
        HttpResponse.json([{ id: 1 }], { headers: pageHeaders(1, 3) }),
      ),
    );
    const result = await client().get("/sync/history");
    expect(result.ok && result.pagination).toEqual({ page: 1, pageCount: 3 });
  });

  it("walks every page via getAllPages and flattens the arrays", async () => {
    server.use(
      http.get(`${TRAKT_API_BASE}/sync/history`, ({ request }) => {
        const page = Number(new URL(request.url).searchParams.get("page"));
        return HttpResponse.json([{ id: page }], { headers: pageHeaders(page, 3) });
      }),
    );
    const result = await client().getAllPages("/sync/history");
    expect(result.ok && result.data).toEqual([{ id: 1 }, { id: 2 }, { id: 3 }]);
  });

  it("treats an endpoint without pagination headers as a single page", async () => {
    server.use(
      http.get(`${TRAKT_API_BASE}/sync/watched/shows`, () => HttpResponse.json([{ id: 1 }])),
    );
    const result = await client().getAllPages("/sync/watched/shows");
    expect(result.ok && result.data).toEqual([{ id: 1 }]);
    expect(result.ok && result.pagination).toBeNull();
  });
});

describe("TraktClient error mapping", () => {
  const path = "/sync/watched/shows";
  const respond = (status: number, headers: Record<string, string> = {}): void => {
    server.use(
      http.get(`${TRAKT_API_BASE}${path}`, () => new HttpResponse(null, { status, headers })),
    );
  };

  it("maps 401 to unauthorized", async () => {
    respond(401);
    expect(await client().get(path)).toEqual({ ok: false, error: { kind: "unauthorized" } });
  });

  it("maps 404 to not-found", async () => {
    respond(404);
    expect(await client().get(path)).toEqual({ ok: false, error: { kind: "not-found" } });
  });

  it("maps 429 and reads Retry-After seconds", async () => {
    respond(429, { "Retry-After": "3" });
    const result = await client().get(path);
    expect(result).toEqual({ ok: false, error: { kind: "rate-limited", retryAfterMs: 3000 } });
  });

  it("maps 500 to server with the status", async () => {
    respond(503);
    expect(await client().get(path)).toEqual({ ok: false, error: { kind: "server", status: 503 } });
  });

  it("maps an unexpected 4xx to server carrying its status", async () => {
    respond(418);
    expect(await client().get(path)).toEqual({ ok: false, error: { kind: "server", status: 418 } });
  });

  it("maps a fetch reject (no response) to network", async () => {
    server.use(http.get(`${TRAKT_API_BASE}${path}`, () => HttpResponse.error()));
    expect(await client().get(path)).toEqual({ ok: false, error: { kind: "network" } });
  });
});
