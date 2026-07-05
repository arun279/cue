/**
 * Trakt `client_id`/`client_secret` are SHA-256 hex digests: 64 lowercase
 * hex chars. Pre-connect we can only *format-check* them —
 * they are proven only when the OAuth exchange succeeds. TMDB, by contrast, is
 * validatable standalone (see `TmdbClient.validate`).
 */
const TRAKT_CREDENTIAL = /^[a-f0-9]{64}$/i;

type CredentialField = "clientId" | "clientSecret";

export interface CredentialFormatError {
  readonly field: CredentialField;
  readonly message: string;
}

function checkOne(
  field: CredentialField,
  value: string,
  label: string,
): CredentialFormatError | null {
  const trimmed = value.trim();
  if (trimmed.length === 0) return { field, message: `${label} is required.` };
  if (!TRAKT_CREDENTIAL.test(trimmed)) {
    return { field, message: `${label} should be the 64-character value from your Trakt app.` };
  }
  return null;
}

/** Per-field format errors for the Trakt credentials; empty when both are well-formed. */
export function checkTraktCredentials(
  clientId: string,
  clientSecret: string,
): CredentialFormatError[] {
  const errors: CredentialFormatError[] = [];
  const id = checkOne("clientId", clientId, "Client ID");
  if (id !== null) errors.push(id);
  const secret = checkOne("clientSecret", clientSecret, "Client secret");
  if (secret !== null) errors.push(secret);
  return errors;
}
