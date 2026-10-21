import type { SnackMessage } from "../stores/snackbar-store";

const dates = (count: number): string => (count === 1 ? "date" : "dates");

export const REPLACED_COPY = {
  mark: (subject: string): SnackMessage => ({
    subject,
    predicate: " was already watched. Trakt changed its watch date to now.",
  }),
  undoNote: "Undo can't restore the earlier date.",
  bulk: (label: string, replaced: number): string =>
    `${label}. Watch ${dates(replaced)} changed for ${replaced} already watched.`,
  rewatch: (label: string, added: number, replaced: number): string =>
    `${label} · ${added} added, ${replaced} watch ${dates(replaced)} changed`,
  play: "Your Trakt account keeps one play per episode, so the earlier date was replaced.",
  episode: "Already watched. Trakt changed the watch date to now.",
};
