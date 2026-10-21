import type { SnackMessage } from "../stores/snackbar-store";

const dates = (count: number): string => (count === 1 ? "watch date" : "watch dates");

export const REPLACED_COPY = {
  mark: (title: string, code: string | null): SnackMessage => ({
    subject: title,
    predicate: `${code === null ? "" : ` ${code}`} was already watched. Trakt changed its watch date to now.`,
  }),
  undoNote: "Undo can't restore the earlier date.",
  bulk: (label: string, replaced: number): string =>
    `${label}. ${replaced === 1 ? "Watch date" : "Watch dates"} changed for ${replaced} already watched.`,
  rewatch: (label: string, added: number, replaced: number): string =>
    `${label} · ${added} added, ${replaced} ${dates(replaced)} changed`,
  play: "Your Trakt account keeps one play per episode, so the earlier date was replaced.",
  episode: "Already watched. Trakt changed the watch date to now.",
};
