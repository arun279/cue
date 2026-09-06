import { artHue } from "@cue/core/data/image-source";

/**
 * A warm dark gradient derived from a seed so an art-missing still/plate is a
 * tinted surface rather than the flat grey monogram that reads as "unstyled
 * template". Shared by the episode hero still and the season-shelf stills.
 */
export function artGradient(seed: string): string {
  const hue = artHue(seed);
  return `linear-gradient(150deg, hsl(${hue} 40% 20%), hsl(${(hue + 40) % 360} 36% 12%))`;
}
