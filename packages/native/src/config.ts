/**
 * Build-time app configuration. Cue is a public OAuth client: its Trakt
 * `client_id` is embedded once by the app author and is PUBLIC, it ships in the
 * bundle and travels in plaintext in every device-code request, and it carries
 * no secret because PKCE proves possession per attempt. Each user then
 * authorizes their OWN Trakt account; they never supply a client id.
 *
 * `babel-preset-expo` replaces each `process.env.EXPO_PUBLIC_*` read below with
 * its value at bundle time, so these are literals in the shipped JavaScript and
 * nothing reads an environment at runtime.
 */

const readEnv = (value: string | undefined): string => value?.trim() ?? "";

export const TRAKT_CLIENT_ID: string = readEnv(process.env["EXPO_PUBLIC_TRAKT_CLIENT_ID"]);

if (TRAKT_CLIENT_ID === "") {
  throw new Error(
    "EXPO_PUBLIC_TRAKT_CLIENT_ID is not set. Set it to your Trakt app's public client id " +
      "(register one at https://trakt.tv/oauth/applications) before building.",
  );
}

/**
 * Optional Trakt origin override, for pointing a build at the local fake Trakt
 * instead of a real account. Read only in a development build, which is the
 * native counterpart of the web app's `--mode mock` gate and holds the same
 * invariant: a stray env file or an exported shell variable cannot redirect a
 * build meant for a real account, because a release bundle compiles this branch
 * out entirely.
 */
const traktBase = __DEV__ ? readEnv(process.env["EXPO_PUBLIC_TRAKT_API_BASE"]) : "";
export const TRAKT_BASE_OVERRIDE: string | undefined = traktBase === "" ? undefined : traktBase;

/**
 * The redirect URI the token grants echo back.
 *
 * The device-code grant does not send it, so first sign-in works without it;
 * the refresh grant does, on every refresh, and Trakt requires it to match the
 * registration exactly. Access tokens last seven days, so a wrong value here is
 * discovered by every user at once a week after a release rather than by CI.
 * It must be registered on the Trakt application, and verified by refreshing a
 * real token from a real build, before the first TestFlight group.
 */
export const NATIVE_REDIRECT_URI = "cue://auth/callback";
