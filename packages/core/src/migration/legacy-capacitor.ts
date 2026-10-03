import { z } from "zod";
import { tokenSchema } from "../domain/model/token";
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
  readonly bulk: KeyValueStore;
  readonly preferences: PreferenceStorage;
}

export interface LegacyMigrationResult {
  readonly adoptedToken: boolean;
  readonly adoptedOps: number;
}

export async function migrateLegacyData(deps: LegacyMigrationDeps): Promise<LegacyMigrationResult> {
  const rawToken = await deps.legacy.read(TOKEN_KEY);
  let adoptedToken = false;
  if (rawToken !== null) {
    const token = tokenSchema.safeParse(tryParse(rawToken));
    if (token.success) {
      const digest = await digestToken(rawToken, deps.digest);
      if (digest !== (await deps.bulk.read(ADOPTED_TOKEN_KEY))) {
        await deps.tokenStore.write(token.data);
        await deps.bulk.write(ADOPTED_TOKEN_KEY, digest);
        adoptedToken = true;
        deps.preferences.setItem(TUTORIAL_KEY, "1");
      }
    }
  }

  const rawOpLog = await deps.legacy.read(OP_LOG_KEY);
  let adoptedOps = 0;
  if (rawOpLog !== null) {
    const migrated = parseOpLog(rawOpLog);
    if (migrated.length > 0) {
      const opLog = createJsonStore<QueuedOp[]>(deps.bulk, OP_LOG_KEY, (value) =>
        Array.isArray(value) ? (value as QueuedOp[]) : [],
      );
      await opLog.write([...migrated, ...((await opLog.read()) ?? [])]);
      adoptedOps = migrated.length;
    }
    await deps.legacy.remove(OP_LOG_KEY);
  }

  return { adoptedToken, adoptedOps };
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
