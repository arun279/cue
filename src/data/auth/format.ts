/**
 * Trakt `client_id` is a SHA-256 hex digest: 64 lowercase hex chars. Pre-connect
 * we can only *format-check* it — it is proven only when the
 * OAuth PKCE exchange succeeds. TMDB, by contrast, is validatable standalone
 * (see `TmdbClient.validate`).
 */
const TRAKT_CREDENTIAL = /^[a-f0-9]{64}$/i;

export interface CredentialFormatError {
  readonly field: "clientId";
  readonly message: string;
}

/** Format error for the Trakt client ID; empty when it is well-formed. */
export function checkTraktCredentials(clientId: string): CredentialFormatError[] {
  const trimmed = clientId.trim();
  if (trimmed.length === 0) return [{ field: "clientId", message: "Client ID is required." }];
  if (!TRAKT_CREDENTIAL.test(trimmed)) {
    return [
      {
        field: "clientId",
        message: "Client ID should be the 64-character value from your Trakt app.",
      },
    ];
  }
  return [];
}
