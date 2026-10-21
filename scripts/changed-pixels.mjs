import pixelmatch from "pixelmatch";

// iPhone 17 Pro: the 54 pt status bar at 3x, and a scroll indicator that ends
// 18 px in. Its floating tab bar's glass starts at 791 pt and its tab items at
// 795 pt; the glass edge between them refracts the content behind it a little
// differently in each capture. Below the edge the glass lets a blurred trace of
// that content through: the largest such difference measured was a pixelmatch
// delta of 0.11, while a changed tab icon or label still differs at 0.5.
// Pixel 7 Pro: the first app row starts at 158 px, and the 4 dp scroll
// indicator. Both indicators fade on their own clocks.
const MASKS = {
  "iOS 1206": { top: 162, right: 18, glassEdge: [2373, 2385], glassThreshold: 0.3 },
  "Android 1440": { top: 158, right: 14 },
};
const THRESHOLD = 0.1;

export const changedPixels = (before, after, platform) => {
  const { width, height } = after;
  const diff = new Uint8Array(width * height * 4);
  if (before.width !== width || before.height !== height) return diff;
  const mask = MASKS[`${platform} ${width}`];
  if (mask === undefined)
    throw new Error(`no status bar mask for ${platform} ${width} px captures`);
  const masked = Buffer.from(after.data);
  before.data.copy(masked, 0, 0, mask.top * width * 4);
  const [edgeTop, edgeBottom] = mask.glassEdge ?? [height, height];
  const glass = Math.min(edgeBottom, height);
  for (let y = mask.top; y < height; y++) {
    const end = (y + 1) * width * 4;
    const start = y >= edgeTop && y < edgeBottom ? end - width * 4 : end - mask.right * 4;
    before.data.copy(masked, start, start, end);
  }
  const region = (from, to, threshold) => {
    const rows = (data) => data.subarray(from * width * 4, to * width * 4);
    return pixelmatch(rows(before.data), rows(masked), rows(diff), width, to - from, {
      threshold,
      diffMask: true,
    });
  };
  const count =
    region(0, glass, THRESHOLD) + region(glass, height, mask.glassThreshold ?? THRESHOLD);
  return count === 0 ? undefined : diff;
};
