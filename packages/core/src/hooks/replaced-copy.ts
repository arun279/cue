import type { SnackMessage } from "../stores/snackbar-store";

// What the app says when Trakt replaced an existing play instead of adding one (Multiple Plays off).
export function replacedMarkMessage(title: string, code: string | null): SnackMessage {
  const what = code === null ? "" : ` ${code}`;
  return {
    subject: title,
    predicate: `${what} was already watched. Trakt replaced its date with now.`,
  };
}

export const REPLACED_UNDO_NOTE = "Undo can't bring the old date back.";

export function replacedBulkMessage(label: string, replaced: number): string {
  const dates = replaced === 1 ? "1 date" : `${replaced} dates`;
  return `${label}. Trakt replaced ${dates} of episodes already watched.`;
}

export function rewatchedMessage(label: string, added: number, replaced: number): string {
  const dates = replaced === 1 ? "1 date replaced" : `${replaced} dates replaced`;
  return `${label}: ${added} added, ${dates}`;
}

export const REPLACED_PLAY_MESSAGE =
  "Trakt replaced this episode's date. Your account keeps one play per episode.";

export const REPLACED_EPISODE_MESSAGE =
  "This episode was already watched. Trakt replaced its date with now.";
