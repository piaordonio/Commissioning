let canvas: HTMLCanvasElement | null = null;

// Real text measurement (canvas), not a per-character estimate -- widths
// vary too much across letters ("W" vs "i") for a flat multiplier to give
// a column that's actually "as wide as its longest value" rather than
// just approximately so.
export function measureTextWidth(text: string, font: string): number {
  if (!canvas) canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d")!;
  ctx.font = font;
  return ctx.measureText(text).width;
}

/** The narrowest column width (px) that fits both the header label and every value, in their real rendered fonts, plus padding. */
export function autoFitColumnWidth(
  values: string[],
  headerLabel: string,
  bodyFont: string,
  headerFont: string,
  paddingPx = 24
): number {
  let widest = measureTextWidth(headerLabel, headerFont);
  for (const v of values) {
    const w = measureTextWidth(v, bodyFont);
    if (w > widest) widest = w;
  }
  return Math.ceil(widest) + paddingPx;
}
