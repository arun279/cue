import { z } from "zod";
import { type Token, tokenSchema } from "../domain/model/token";
import type { QueuedOp } from "../domain/write-queue/types";
import type { CryptoPort } from "../ports/crypto";
import { createJsonStore } from "../ports/json-store";
import type { KeyValueStore } from "../ports/kv";
import type { LegacyStore } from "../ports/legacy-store";
import type { PreferenceStorage } from "../ports/preference-storage";
import { OP_LOG_KEY, TOKEN_KEY } from "../ports/storage-keys";
import type { TokenStore } from "../ports/token-store";

const ADOPTED_TOKEN_KEY = "cue.legacy-token-adopted";
const TUTORIAL_KEY = "cue.tutorial-mark-dismissed";

const requestSchema = z.object({
  method: z.literal("POST"),
  path: z.string(),
  body: z.unknown(),
});

const queuedOpSchema = z.object({
  id: z.string(),
  itemKey: z.string(),
  request: requestSchema,
  inverse: requestSchema,
  inversePatch: z.unknown(),
  watchedAt: z.string().nullable(),
  fromState: z.enum(["present", "absent"]),
  toState: z.enum(["present", "absent"]),
  reconcileKeys: z.array(z.string()),
});

function parseOpLog(raw: string): QueuedOp[] {
  let decoded: unknown;
  try {
    decoded = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(decoded)) return [];
  const ops: QueuedOp[] = [];
  for (const entry of decoded) {
    const op = queuedOpSchema.safeParse(entry);
    if (op.success) ops.push(op.data);
  }
  return ops;
}

export interface LegacyMigrationDeps {
  readonly digest: CryptoPort["digest"];
  readonly legacy: LegacyStore;
  readonly tokenStore: TokenStore;
  readonly secure: KeyValueStore;
  readonly bulk: KeyValueStore;
  readonly preferences: PreferenceStorage;
}

export interface LegacyMigrationResult {
  readonly adoptedToken: boolean;
  readonly adoptedOps: number;
}

// The legacy store is deleted only once its token is adopted, was adopted by an earlier
// build, or is unusable, so a failed adoption keeps the token for the next launch to retry.
export async function migrateLegacyData(deps: LegacyMigrationDeps): Promise<LegacyMigrationResult> {
  const adoptedToken = await adoptToken(deps);
  const adoptedOps = await adoptOpLog(deps);
  await deps.legacy.clear();
  return { adoptedToken, adoptedOps };
}

async function adoptToken(deps: LegacyMigrationDeps): Promise<boolean> {
  const rawToken = await deps.legacy.read(TOKEN_KEY);
  if (rawToken === null) return false;
  const token = tokenSchema.safeParse(tryParse(rawToken));
  if (!token.success) return false;
  const digest = await digestToken(rawToken, deps.digest);
  if (digest === (await deps.bulk.read(ADOPTED_TOKEN_KEY))) return false;
  await deps.tokenStore.write(token.data);
  const persisted = await createJsonStore<Token>(deps.secure, TOKEN_KEY, (value) =>
    tokenSchema.parse(value),
  ).read();
  if (JSON.stringify(persisted) !== JSON.stringify(token.data)) {
    throw new Error("The adopted Trakt token did not read back from the secure store.");
  }
  await deps.bulk.write(ADOPTED_TOKEN_KEY, digest);
  deps.preferences.setItem(TUTORIAL_KEY, "1");
  return true;
}

async function adoptOpLog(deps: LegacyMigrationDeps): Promise<number> {
  const rawOpLog = await deps.legacy.read(OP_LOG_KEY);
  if (rawOpLog === null) return 0;
  const migrated = parseOpLog(rawOpLog);
  if (migrated.length > 0) {
    const opLog = createJsonStore<QueuedOp[]>(deps.bulk, OP_LOG_KEY, (value) =>
      Array.isArray(value) ? (value as QueuedOp[]) : [],
    );
    await opLog.write([...migrated, ...((await opLog.read()) ?? [])]);
  }
  await deps.legacy.remove(OP_LOG_KEY);
  return migrated.length;
}

async function digestToken(raw: string, digest: CryptoPort["digest"]): Promise<string> {
  const bytes = await digest(new TextEncoder().encode(raw));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function tryParse(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}
