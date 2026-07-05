import { TMDB_API_BASE, TmdbClient } from "@data/tmdb/client";
import { delay, HttpResponse, http } from "msw";
import { describe, expect, it } from "vitest";
import { mswServer } from "./_msw";

const server = mswServer();
const BEARER = "eyJhbGciOiJIUzI1NiJ9.eyJhdWQiOiJjdWUiLCJzdWIiOiIxMjMifQ.abcdef1234567890signature";
const V3_KEY = "0123456789abcdef0123456789abcdef";

async function captureRequest(
  credential: string,
  query?: Record<string, string>,
): Promise<{ auth: string | null; url: string }> {
  let auth: string | null = null;
  let url = "";
  server.use(
    http.get(`${TMDB_API_BASE}/tv/1`, ({ request }) => {
      auth = request.headers.get("authorization");
      url = request.url;
      return HttpResponse.json({ id: 1 });
    }),
  );
  await new TmdbClient({ credential }).get("/tv/1", query);
  return { auth, url };
}

describe("TmdbClient auth-shape selection", () => {
  it("sends the v4 token as a bearer header and no api_key param", async () => {
    const { auth, url } = await captureRequest(BEARER);
    expect(auth).toBe(`Bearer ${BEARER}`);
    expect(new URL(url).searchParams.has("api_key")).toBe(false);
  });

  it("falls back to ?api_key= for a v3 key and sends no Authorization header", async () => {
    const { auth, url } = await captureRequest(V3_KEY);
    expect(auth).toBeNull();
    expect(new URL(url).searchParams.get("api_key")).toBe(V3_KEY);
  });

  it("appends query params alongside the auth", async () => {
    const { url } = await captureRequest(BEARER, {
      append_to_response: "external_ids,images,videos",
    });
    expect(new URL(url).searchParams.get("append_to_response")).toBe("external_ids,images,videos");
  });
});

describe("TmdbClient in-flight de-dupe", () => {
  it("collapses identical concurrent requests into one fetch", async () => {
    let calls = 0;
    server.use(
      http.get(`${TMDB_API_BASE}/tv/1`, async () => {
        calls += 1;
        await delay(10);
        return HttpResponse.json({ id: 1, calls });
      }),
    );
    const client = new TmdbClient({ credential: BEARER });
    const results = await Promise.all([
      client.get("/tv/1"),
      client.get("/tv/1"),
      client.get("/tv/1"),
    ]);
    expect(calls).toBe(1);
    expect(results[0]).toEqual(results[2]);
  });

  it("does not share a promise once the first has settled", async () => {
    let calls = 0;
    server.use(
      http.get(`${TMDB_API_BASE}/tv/1`, () => {
        calls += 1;
        return HttpResponse.json({ id: 1 });
      }),
    );
    const client = new TmdbClient({ credential: BEARER });
    await client.get("/tv/1");
    await client.get("/tv/1");
    expect(calls).toBe(2);
  });
});

describe("TmdbClient concurrency cap", () => {
  it("never exceeds 6 in-flight requests", async () => {
    let active = 0;
    let peak = 0;
    server.use(
      http.get(`${TMDB_API_BASE}/tv/:id`, async () => {
        active += 1;
        peak = Math.max(peak, active);
        await delay(15);
        active -= 1;
        return HttpResponse.json({});
      }),
    );
    const client = new TmdbClient({ credential: BEARER });
    await Promise.all(Array.from({ length: 15 }, (_, i) => client.get(`/tv/${i}`)));
    expect(peak).toBeLessThanOrEqual(6);
    expect(peak).toBe(6);
  });
});

describe("TmdbClient configuration", () => {
  it("parses /configuration into the image resolver config", async () => {
    server.use(
      http.get(`${TMDB_API_BASE}/configuration`, () =>
        HttpResponse.json({
          images: {
            secure_base_url: "https://image.tmdb.org/t/p/",
            poster_sizes: ["w92", "w342", "original"],
          },
        }),
      ),
    );
    const config = await new TmdbClient({ credential: BEARER }).getImageConfig("w342");
    expect(config).toEqual({ secureBaseUrl: "https://image.tmdb.org/t/p/", posterSize: "w342" });
  });

  it("falls back to the largest offered size when the requested tier is absent", async () => {
    server.use(
      http.get(`${TMDB_API_BASE}/configuration`, () =>
        HttpResponse.json({
          images: { secure_base_url: "https://image.tmdb.org/t/p/", poster_sizes: ["w92", "w185"] },
        }),
      ),
    );
    const config = await new TmdbClient({ credential: V3_KEY }).getImageConfig("w342");
    expect(config.posterSize).toBe("w185");
  });
});
