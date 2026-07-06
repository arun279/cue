/**
 * A warm dark gradient derived from a seed so an art-missing still/plate is a
 * tinted surface rather than the flat grey monogram that reads as "unstyled
 * template". Shared by the episode hero still and the season-shelf stills.
 */
export function artGradient(seed: string): string {
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  const hue = hash % 360;
  return `linear-gradient(150deg, hsl(${hue} 40% 20%), hsl(${(hue + 40) % 360} 36% 12%))`;
}
