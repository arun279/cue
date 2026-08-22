/**
 * Build-time app configuration. Cue is a public OAuth client:
 * its Trakt `client_id` is embedded once by the app author and is PUBLIC: it
 * ships in the built JS and travels in plaintext in every authorize URL, and it
 * carries no secret because PKCE proves possession per attempt. Each user then
 * authorizes their OWN Trakt account via OAuth; they never supply a client id.
 */

const readEnv = (value: string | undefined): string => value?.trim() ?? "";

/** The app's public Trakt client id, embedded at build time from `VITE_TRAKT_CLIENT_ID`. */
export const TRAKT_CLIENT_ID: string = readEnv(import.meta.env.VITE_TRAKT_CLIENT_ID);

if (TRAKT_CLIENT_ID === "") {
  throw new Error(
    "VITE_TRAKT_CLIENT_ID is not set. Copy .env.example to .env and set it to your Trakt " +
      "app's public client id (register one at https://trakt.tv/oauth/applications).",
  );
}

/**
 * Optional Trakt origin override (`VITE_TRAKT_API_BASE`), for pointing a build at
 * the local mock (`scripts/mock-trakt`) instead of a real account. It is read
 * only under `--mode mock`, so a stray `.env` line or an exported shell variable
 * cannot redirect a build that is meant for a real account: every other mode
 * leaves the API client on `api.trakt.tv` and the OAuth authorize page on
 * `trakt.tv`. Under the mock mode one host serves both, because the mock does.
 */
const traktBase =
  import.meta.env.MODE === "mock" ? readEnv(import.meta.env.VITE_TRAKT_API_BASE) : "";
export const TRAKT_BASE_OVERRIDE: string | undefined = traktBase === "" ? undefined : traktBase;
