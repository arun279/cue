import type { HistoryEntry } from "@cue/core/domain/history";
import { localTimeZone } from "@cue/core/domain/time";
import { CheckControl } from "@ui/components/CheckControl";
import { EpisodeRow } from "@ui/components/EpisodeRow";
import { SectionHeader } from "@ui/components/SectionHeader";
import { useHistory } from "@ui/hooks/useHistory";
import { useRemovalSnacks } from "@ui/hooks/useRemovalSnacks";
import { usePrefs } from "@ui/prefs/prefs-store";
import { entryDetail, entryLink } from "@ui/screens/history/history-view";
import { Poster } from "@ui/screens/up-next/Poster";
import { Fragment, type ReactElement } from "react";

const SCOPE_DAYS = 7;
const MAX_ENTRIES = 10;
const DAY_MS = 24 * 60 * 60 * 1000;

const timeFmt = new Intl.DateTimeFormat("en-US", {
  timeZone: localTimeZone(),
  hour: "numeric",
  minute: "2-digit",
});

const dayKeyFmt = new Intl.DateTimeFormat("en-CA", {
  timeZone: localTimeZone(),
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

interface PreviouslyDay {
  readonly key: string;
  readonly label: string;
  readonly entries: readonly HistoryEntry[];
}

/**
 * "Previously": the last seven days of plays (capped at ten) at the bottom of
 * the home scroll: the everyday mis-tap fix, one scroll away, where a fresh
 * mark visibly lands. A preview by rule: it never grows filters or search; the
 * canonical History is `/history`. Each entry's filled check removes exactly
 * that play (by history event id), snackbar-reversible.
 */
export function Previously(): ReactElement | null {
  const showsEnabled = usePrefs((s) => s.showsEnabled);
  const moviesEnabled = usePrefs((s) => s.moviesEnabled);
  const filter = !moviesEnabled ? "tv" : !showsEnabled ? "movies" : "all";
  const view = useHistory({ filter, preview: true });
  useRemovalSnacks(view);

  const cutoffKey = dayKeyFmt.format(Date.now() - (SCOPE_DAYS - 1) * DAY_MS);
  const days: PreviouslyDay[] = [];
  let taken = 0;
  for (const day of view.days) {
    if (taken >= MAX_ENTRIES || day.dayKey < cutoffKey) break;
    const entries = day.groups.flatMap((group) => group.entries).slice(0, MAX_ENTRIES - taken);
    if (entries.length === 0) continue;
    taken += entries.length;
    days.push({ key: day.dayKey, label: day.label.replace(",", ""), entries });
  }

  if (days.length === 0) return null;

  return (
    <section className="home-section" data-testid="previously">
      <SectionHeader
        label="Previously"
        link={{ label: "History", to: "/history", testId: "previously-history" }}
      />
      {days.map((day) => (
        <Fragment key={day.key}>
          <h3 className="day-subheader">{day.label}</h3>
          <ul className="row-list">
            {day.entries.map((entry) => (
              <li key={entry.historyId}>
                <EpisodeRow
                  variant="previously"
                  testId="previously-row"
                  art={<Poster title={entry.title} posters={entry.posters} variant="s32" />}
                  title={
                    <>
                      <strong>{entry.title}</strong> · {entryDetail(entry)}
                    </>
                  }
                  meta={timeFmt.format(new Date(entry.watchedAt))}
                  trailing={
                    <CheckControl
                      state="watched"
                      size={44}
                      label="Watched. Tap to remove."
                      onPress={() => void view.removePlay(entry)}
                    />
                  }
                  link={entryLink(entry)}
                  linkLabel={`${entry.title} · ${entryDetail(entry)}`}
                />
              </li>
            ))}
          </ul>
        </Fragment>
      ))}
    </section>
  );
}
