import type { BrowserContext, Page } from "@playwright/test";

export type NetworkMode = "ok" | "abort" | "delay";

export interface HermeticControls {
  setMode: (mode: NetworkMode) => void;
  setCount: (count: number) => void;
}

const OTHER_ORIGINS = [
  "**/api.trakt.tv/**",
  "**/trakt.tv/**",
  "**/api.themoviedb.org/**",
  "**/image.tmdb.org/**",
];

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Intercept every Trakt/TMDB origin at the browser-context level so no request
 * escapes to the real network (hermetic e2e). The frame's `/networks`
 * boot probe is controllable so persistence tests can delay or fail it on demand.
 */
export async function installHermeticRoutes(context: BrowserContext): Promise<HermeticControls> {
  let mode: NetworkMode = "ok";
  let count = 12;

  // Catch-alls first; the specific /networks route is registered last so it wins.
  for (const pattern of OTHER_ORIGINS) {
    await context.route(pattern, (route) =>
      route.fulfill({ status: 200, contentType: "application/json", body: "[]" }),
    );
  }

  await context.route("**/api.trakt.tv/networks*", async (route) => {
    if (mode === "abort") {
      await route.abort();
      return;
    }
    if (mode === "delay") await sleep(2000);
    const body = Array.from({ length: count }, (_, index) => ({ name: `Net ${index}` }));
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(body),
    });
  });

  return {
    setMode: (next) => {
      mode = next;
    },
    setCount: (next) => {
      count = next;
    },
  };
}

/** A dehydrated TanStack Query cache holding just the frame-status query. */
export function buildPersistedClient(count: number, ageMs: number): string {
  const updatedAt = Date.now() - ageMs;
  return JSON.stringify({
    buster: "cue-m3",
    timestamp: updatedAt,
    clientState: {
      mutations: [],
      queries: [
        {
          queryKey: ["frame", "status"],
          queryHash: '["frame","status"]',
          state: {
            data: { count },
            dataUpdateCount: 1,
            dataUpdatedAt: updatedAt,
            error: null,
            errorUpdateCount: 0,
            errorUpdatedAt: 0,
            fetchFailureCount: 0,
            fetchFailureReason: null,
            fetchMeta: null,
            isInvalidated: false,
            status: "success",
            fetchStatus: "idle",
          },
        },
      ],
    },
  });
}

/** Write the persisted cache into idb-keyval's store, matching the app's persister key. */
export async function seedQueryCache(page: Page, serialized: string): Promise<void> {
  await page.evaluate(
    (value) =>
      new Promise<void>((resolve, reject) => {
        const open = indexedDB.open("keyval-store");
        open.onupgradeneeded = () => open.result.createObjectStore("keyval");
        open.onsuccess = () => {
          const db = open.result;
          const tx = db.transaction("keyval", "readwrite");
          tx.objectStore("keyval").put(value, "cue.query-cache");
          tx.oncomplete = () => {
            db.close();
            resolve();
          };
          tx.onerror = () => reject(tx.error);
        };
        open.onerror = () => reject(open.error);
      }),
    serialized,
  );
}
