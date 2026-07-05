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

const SEED_TOKEN = JSON.stringify({
  access_token: "seed-access",
  refresh_token: "seed-refresh",
  created_at: 1_700_000_000,
  expires_in: 7_776_000,
});
const SEED_CREDS = JSON.stringify({
  clientId: "a".repeat(64),
  clientSecret: "b".repeat(64),
  tmdbKey: "",
});

const OAUTH_TOKEN = {
  access_token: "connected-access",
  refresh_token: "connected-refresh",
  created_at: 1_700_000_000,
  expires_in: 7_776_000,
};

/**
 * Seed a stored Trakt token + creds into idb-keyval before the app boots, so a
 * suite starts past the onboarding gate (tests start authenticated
 * except the auth-flow tests). The write transaction is created at document
 * start, ahead of the app's read, so the boot reads it deterministically.
 */
export async function seedAuth(context: BrowserContext): Promise<void> {
  await context.addInitScript(
    ({ token, creds }) => {
      const open = indexedDB.open("keyval-store");
      open.onupgradeneeded = () => open.result.createObjectStore("keyval");
      open.onsuccess = () => {
        const db = open.result;
        const tx = db.transaction("keyval", "readwrite");
        const store = tx.objectStore("keyval");
        store.put(token, "cue.trakt.token");
        store.put(creds, "cue.trakt.creds");
        tx.oncomplete = () => db.close();
      };
    },
    { token: SEED_TOKEN, creds: SEED_CREDS },
  );
}

export interface OAuthControls {
  setStateEcho: (mode: "match" | "mismatch") => void;
  setTokenStatus: (status: number) => void;
  setTmdbValid: (valid: boolean) => void;
  /** How the device-token poll resolves once past the initial pending replies. */
  setDeviceOutcome: (outcome: "success" | "denied" | "expired") => void;
  /** The `state` the authorize redirect saw, letting a test assert a non-empty nonce was sent. */
  getAuthorizeState: () => string | null;
  /** Every JSON body posted to `/oauth/token` (auth-code + refresh exchanges). */
  getTokenRequests: () => ReadonlyArray<Record<string, unknown>>;
  /** Every JSON body posted to `/oauth/revoke`. */
  getRevokeRequests: () => ReadonlyArray<Record<string, unknown>>;
}

/**
 * Mock every OAuth endpoint across both Trakt origins (hermetic e2e):
 * the `trakt.tv` authorize redirect echoes the caller's `state` (or tampers it),
 * and the `api.trakt.tv` token/device/revoke endpoints plus TMDB validation are
 * fulfilled with pinned fixtures. Register after `installHermeticRoutes` so
 * these specific routes win over the catch-alls.
 */
export async function installOAuthRoutes(context: BrowserContext): Promise<OAuthControls> {
  let stateEcho: "match" | "mismatch" = "match";
  let tokenStatus = 200;
  let tmdbValid = true;
  let deviceOutcome: "success" | "denied" | "expired" = "success";
  let devicePolls = 0;
  let authorizeState: string | null = null;
  const tokenRequests: Array<Record<string, unknown>> = [];
  const revokeRequests: Array<Record<string, unknown>> = [];

  await context.route("**/trakt.tv/oauth/authorize*", async (route) => {
    const url = new URL(route.request().url());
    const redirectUri = url.searchParams.get("redirect_uri") ?? "";
    const state = url.searchParams.get("state") ?? "";
    authorizeState = state;
    const echoed = stateEcho === "match" ? state : "tampered-state";
    await route.fulfill({
      status: 302,
      headers: { location: `${redirectUri}?code=good-code&state=${echoed}` },
    });
  });

  await context.route("**/api.trakt.tv/oauth/token", (route) => {
    tokenRequests.push((route.request().postDataJSON() ?? {}) as Record<string, unknown>);
    return route.fulfill({
      status: tokenStatus,
      contentType: "application/json",
      body:
        tokenStatus === 200
          ? JSON.stringify(OAUTH_TOKEN)
          : JSON.stringify({ error: "invalid_grant" }),
    });
  });

  await context.route("**/api.trakt.tv/oauth/device/code", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        device_code: "dev-code-1",
        user_code: "CUE-1234",
        verification_url: "https://trakt.tv/activate",
        expires_in: 600,
        interval: 1,
      }),
    }),
  );

  await context.route("**/api.trakt.tv/oauth/device/token", (route) => {
    devicePolls += 1;
    if (devicePolls < 2) {
      return route.fulfill({ status: 400, contentType: "application/json", body: "{}" });
    }
    if (deviceOutcome === "denied") {
      return route.fulfill({ status: 418, contentType: "application/json", body: "{}" });
    }
    if (deviceOutcome === "expired") {
      return route.fulfill({ status: 410, contentType: "application/json", body: "{}" });
    }
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(OAUTH_TOKEN),
    });
  });

  await context.route("**/api.trakt.tv/oauth/revoke", (route) => {
    revokeRequests.push((route.request().postDataJSON() ?? {}) as Record<string, unknown>);
    return route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
  });

  await context.route("**/api.themoviedb.org/3/configuration*", (route) =>
    route.fulfill({
      status: tmdbValid ? 200 : 401,
      contentType: "application/json",
      body: tmdbValid
        ? JSON.stringify({
            images: { secure_base_url: "https://image.tmdb.org/t/p/", poster_sizes: ["w342"] },
          })
        : JSON.stringify({ status_code: 7, status_message: "Invalid API key" }),
    }),
  );

  return {
    setStateEcho: (mode) => {
      stateEcho = mode;
    },
    setTokenStatus: (status) => {
      tokenStatus = status;
    },
    setTmdbValid: (valid) => {
      tmdbValid = valid;
    },
    setDeviceOutcome: (outcome) => {
      deviceOutcome = outcome;
    },
    getAuthorizeState: () => authorizeState,
    getTokenRequests: () => tokenRequests,
    getRevokeRequests: () => revokeRequests,
  };
}

/** Read a raw stored string straight from idb-keyval's object store (post-write assertions). */
export async function readStored(page: Page, key: string): Promise<string | null> {
  return page.evaluate(
    (k) =>
      new Promise<string | null>((resolve, reject) => {
        const open = indexedDB.open("keyval-store");
        open.onupgradeneeded = () => open.result.createObjectStore("keyval");
        open.onsuccess = () => {
          const db = open.result;
          const tx = db.transaction("keyval", "readonly");
          const request = tx.objectStore("keyval").get(k);
          request.onsuccess = () => {
            db.close();
            resolve((request.result as string | undefined) ?? null);
          };
          request.onerror = () => reject(request.error);
        };
        open.onerror = () => reject(open.error);
      }),
    key,
  );
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
