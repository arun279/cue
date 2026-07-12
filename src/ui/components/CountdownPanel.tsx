import { localTimeZone } from "@domain/time";
import type { ReactElement } from "react";

const DAY_MS = 24 * 60 * 60 * 1000;

/** Air moments are appointments, so they read in the viewer's LOCAL day and
 * clock — unlike a past air date, "tonight at 8" must mean the viewer's 8. */
const airsDayFmt = new Intl.DateTimeFormat("en-US", {
  timeZone: localTimeZone(),
  weekday: "short",
  month: "short",
  day: "numeric",
});
const airsTimeFmt = new Intl.DateTimeFormat("en-US", {
  timeZone: localTimeZone(),
  hour: "numeric",
  minute: "2-digit",
});

/** `Airs Thu Jul 16 · 8:00 PM`; null when the timestamp doesn't parse. */
export function airsLine(iso: string): string | null {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return null;
  return `Airs ${airsDayFmt.format(t).replace(",", "")} · ${airsTimeFmt.format(t)}`;
}

/** `S4 in 87 days` (or `Returns in 87 days` untitled); `today` at zero days. */
export function returnsLine(iso: string, title: string | undefined, now: number): string | null {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return null;
  const days = Math.ceil((t - now) / DAY_MS);
  const lead = title ?? "Returns";
  if (days <= 0) return `${lead} today`;
  return `${lead} in ${days} ${days === 1 ? "day" : "days"}`;
}

interface CountdownPanelProps {
  /** `unaired-episode` = the centered panel that replaces an episode still;
   * `returning-season` = the row-level countdown text. */
  readonly mode: "unaired-episode" | "returning-season";
  /** ISO timestamp of the air / return moment. */
  readonly date: string;
  /** Episode title above the panel line, or the season lead (`S4`) in the
   * returning text. */
  readonly title?: string;
  /** Frozen clock for relative phrasing, one per render pass. */
  readonly now?: number;
}

/** Purely presentational future-date copy: nothing to mark yet, so it renders
 * text only — no control, no fabricated progress. */
export function CountdownPanel({
  mode,
  date,
  title,
  now = Date.now(),
}: CountdownPanelProps): ReactElement | null {
  if (mode === "returning-season") {
    const text = returnsLine(date, title, now);
    return text === null ? null : <span className="countdown-text">{text}</span>;
  }
  const airs = airsLine(date);
  if (airs === null) return null;
  return (
    <div className="countdown-panel">
      {title !== undefined && <span className="countdown-panel__title">{title}</span>}
      <span className="countdown-panel__when">{airs}</span>
    </div>
  );
}
