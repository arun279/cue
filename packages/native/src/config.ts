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
 * instead of a real account. It is the native counterpart of the web app's
 * `--mode mock` gate.
 *
 * It cannot be read behind `__DEV__`, which is where a JavaScript-side guard
 * would want to sit. An Expo bundle built for development throws at startup when
 * it is embedded in the app rather than served by Metro, and Expo's own answer is
 * that the only way to avoid it is to bundle with development off
 * (https://github.com/expo/expo/pull/37323). A `__DEV__` branch would therefore
 * compile the override out of every binary that can actually be installed and
 * driven, which is every binary the end-to-end lane builds.
 *
 * The invariant moves to the generated project, where it is checked rather than
 * assumed. iOS refuses a plain HTTP load to an IP address unless the Info.plist
 * names an App Transport Security exception for it; `app.config.ts` writes that
 * exception only when this origin is set, and `verify-ios-privacy.sh` asserts on
 * every generated project that a build without it carries none.
 */
const traktBase = readEnv(process.env["EXPO_PUBLIC_TRAKT_API_BASE"]);
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
