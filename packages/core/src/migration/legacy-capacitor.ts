import { z } from "zod";
import { tokenSchema } from "../domain/model/token";
import type { QueuedOp } from "../domain/write-queue/types";
import { createJsonStore } from "../ports/json-store";
import type { KeyValueStore } from "../ports/kv";
import type { LegacyStore } from "../ports/legacy-store";
import type { PreferenceStorage } from "../ports/preference-storage";
import type { TokenStore } from "../ports/token-store";

const LEGACY_TOKEN_KEY = "cue.trakt.token";
const LEGACY_OP_LOG_KEY = "cue.write-queue";
const OP_LOG_KEY = "cue.write-queue";
/** The one preference worth seeding: without it an established user is offered
 * the first-mark tutorial again, which is the only loss that reads as a bug
 * rather than as a reset. */
const TUTORIAL_KEY = "cue.tutorial-mark-dismissed";

const requestSchema = z.object({
  method: z.literal("POST"),
  path: z.string(),
  body: z.unknown(),
});

/**
 * The op-log the Capacitor build persisted, validated on the way in.
 *
 * The live op-log store validates nothing beyond `Array.isArray`, which is
 * right for a value this app wrote itself an instant ago and wrong for one
 * another build wrote at an unknown version: a malformed op replayed is a play
 * sent to Trakt that the user never made, and a dropped op is a play that does
 * not reach it. Between those two, dropping is the one that is visible.
 *
 * The parser is here rather than in `domain/write-queue/` because the shape
 * witness is taken over that tree, and this file states no persisted shape of
 * its own: it re-states one, and `parseOpLog`'s return type is what keeps the
 * two from drifting.
 */
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
  readonly legacy: LegacyStore;
  /** The secure store the token lands in. */
  readonly tokenStore: TokenStore;
  /** The bulk store the op log lands in. */
  readonly bulk: KeyValueStore;
  readonly preferences: PreferenceStorage;
}

export interface LegacyMigrationResult {
  /** A legacy token was present and is now the session's. */
  readonly adoptedToken: boolean;
  /** How many ops were carried across. */
  readonly adoptedOps: number;
}

/**
 * Take what the Capacitor build left behind, on every boot.
 *
 * Not "migrate once when the secure store is empty". While a Capacitor build is
 * still a shippable rollback target, both apps can write a token, and the only
 * rule that matches what a user who rolled back, signed in again and rolled
 * forward expects is last-writer-wins with the legacy store preferred. So the
 * legacy token is read every boot and left where it is; it is removed in the
 * commit that removes the rollback target.
 *
 * The op log is the opposite case and is removed on read: it is the one store
 * whose loss is silent data loss, an op in it is a play the user marked that
 * has not reached Trakt, and a replayed op-log is a duplicate play.
 *
 * The last-activities baseline is deliberately not migrated. With no baseline
 * the first poll establishes one without invalidating anything, and the query
 * cache is unreadable from here anyway, so there is nothing stale to protect.
 */
export async function migrateLegacyCapacitorData(
  deps: LegacyMigrationDeps,
): Promise<LegacyMigrationResult> {
  const rawToken = await deps.legacy.read(LEGACY_TOKEN_KEY);
  let adoptedToken = false;
  if (rawToken !== null) {
    const token = tokenSchema.safeParse(tryParse(rawToken));
    if (token.success) {
      await deps.tokenStore.write(token.data);
      adoptedToken = true;
      // An install that has a token is an install that has been used, so the
      // one-time caption has been seen whether or not its own key survived.
      deps.preferences.setItem(TUTORIAL_KEY, "1");
    }
  }

  const rawOpLog = await deps.legacy.read(LEGACY_OP_LOG_KEY);
  let adoptedOps = 0;
  if (rawOpLog !== null) {
    const migrated = parseOpLog(rawOpLog);
    if (migrated.length > 0) {
      const opLog = createJsonStore<QueuedOp[]>(deps.bulk, OP_LOG_KEY, (value) =>
        Array.isArray(value) ? (value as QueuedOp[]) : [],
      );
      // Ahead of anything this install queued: the legacy ops are older, and
      // the queue replays in order.
      await opLog.write([...migrated, ...((await opLog.read()) ?? [])]);
      adoptedOps = migrated.length;
    }
    await deps.legacy.remove(LEGACY_OP_LOG_KEY);
  }

  return { adoptedToken, adoptedOps };
}

function tryParse(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}
