import type { ReactElement } from "react";

/**
 * The Cue brand mark: an ivory "C" cradling the amber cue-dot on a warm
 * near-black tile: the tally-lamp "on-air" cue that gives the app its name.
 * A vector mark (matches public/icon.svg used for the favicon + app icon) so it
 * stays crisp from the 1.75rem sidebar mark to any store size.
 */
export function CueMark({ className }: { className?: string }): ReactElement {
  return (
    <svg className={className} viewBox="0 0 512 512" aria-hidden="true" focusable="false">
      <rect width="512" height="512" rx="112" fill="#0e0c0a" />
      <path
        d="M 153.4 169.8 A 134 134 0 1 1 153.4 342.2"
        fill="none"
        stroke="#f4efe7"
        strokeWidth="62"
        strokeLinecap="round"
      />
      <circle cx="162.8" cy="264" r="44" fill="#f5b841" />
    </svg>
  );
}
