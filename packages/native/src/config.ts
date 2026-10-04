const readEnv = (value: string | undefined): string => value?.trim() ?? "";

export const TRAKT_CLIENT_ID: string = readEnv(process.env["EXPO_PUBLIC_TRAKT_CLIENT_ID"]);

if (TRAKT_CLIENT_ID === "") {
  throw new Error(
    "EXPO_PUBLIC_TRAKT_CLIENT_ID is not set. Set it to your Trakt app's public client id " +
      "(register one at https://trakt.tv/oauth/applications) before building.",
  );
}

// Not behind __DEV__: an embedded development bundle throws at startup (https://github.com/expo/expo/pull/37323).
const traktBase = readEnv(process.env["EXPO_PUBLIC_TRAKT_API_BASE"]);
export const TRAKT_BASE_OVERRIDE: string | undefined = traktBase === "" ? undefined : traktBase;

// Trakt's refresh grant requires the redirect URI to match the registration exactly.
export const NATIVE_REDIRECT_URI = "cue://auth/callback";
