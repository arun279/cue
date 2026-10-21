import type { SnackMessage } from "../stores/snackbar-store";

// What the app says when Trakt replaced an existing play instead of adding one (Multiple Plays off).
export function replacedMarkMessage(title: string, code: string | null): SnackMessage {
  const what = code === null ? "" : ` ${code}`;
  return {
    subject: title,
    predicate: `${what} was already watched. Trakt changed its watch date to now.`,
  };
}

export const REPLACED_UNDO_NOTE = "Undo can't restore the earlier date.";

export function replacedBulkMessage(label: string, replaced: number): string {
  const dates = replaced === 1 ? "Watch date" : "Watch dates";
  return `${label}. ${dates} changed for ${replaced} already watched.`;
}

export function rewatchedMessage(label: string, added: number, replaced: number): string {
  const dates = replaced === 1 ? "1 watch date" : `${replaced} watch dates`;
  return `${label} · ${added} added, ${dates} changed`;
}

export const REPLACED_PLAY_MESSAGE =
  "Your Trakt account keeps one play per episode, so the earlier date was replaced.";

export const REPLACED_EPISODE_MESSAGE = "Already watched. Trakt changed the watch date to now.";
