import { resolvePoster } from "@data/image-source";
import { artGradient } from "@ui/components/artGradient";
import { type ReactElement, useState } from "react";

interface StillProps {
  readonly title: string;
  readonly stills?: readonly string[] | null;
  readonly className?: string;
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
      <span className={`${cls} still-thumb--text`} style={{ background: artGradient(title) }} />
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
