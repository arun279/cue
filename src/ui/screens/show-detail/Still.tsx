import { resolvePoster } from "@data/image-source";
import { type ReactElement, useState } from "react";

interface StillProps {
  readonly title: string;
  readonly stills?: readonly string[] | null;
  readonly className?: string;
}

/**
 * A warm dark gradient derived from the seed so an art-missing 16:9 still is a
 * tinted plate rather than flat grey, matching the Poster fallback.
 */
function gradientFor(seed: string): string {
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  const hue = hash % 360;
  return `linear-gradient(150deg, hsl(${hue} 40% 20%), hsl(${(hue + 40) % 360} 36% 12%))`;
}

/**
 * A 16:9 episode still that resolves the Trakt inline screenshot and degrades to
 * the deterministic gradient plate when art is missing or fails to load, so a
 * broken image never tears the season shelf.
 */
export function Still({ title, stills, className }: StillProps): ReactElement {
  const [broken, setBroken] = useState(false);
  const resolved = resolvePoster({ title, traktPosters: stills });
  const cls = `still-thumb${className === undefined ? "" : ` ${className}`}`;

  if (resolved.source === "placeholder" || broken) {
    return (
      <span className={`${cls} still-thumb--text`} style={{ background: gradientFor(title) }} />
    );
  }
  return (
    <img
      className={cls}
      src={resolved.url}
      alt=""
      loading="lazy"
      decoding="async"
      onError={() => setBroken(true)}
    />
  );
}
