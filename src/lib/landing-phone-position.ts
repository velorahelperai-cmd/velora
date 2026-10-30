type CompactPlacement = {
  landscape: boolean;
  rangeWidth: number;
  rangeHeight: number;
  width: number;
  height: number;
  slotX: number;
  slotWidth: number;
  slotY: number;
  slotHeight: number;
  minX: number;
  maxX: number;
  copyLeft: number | null;
  copyRight: number | null;
  copyBottom: number | null;
};

export function compactPhonePosition(p: CompactPlacement) {
  const clamp = (min: number, max: number, value: number) => Math.max(min, Math.min(Math.max(min, max), value));
  if (p.landscape) {
    const slotCenter = p.slotX + p.slotWidth / 2;
    let x = clamp(p.minX, p.maxX, slotCenter - p.width / 2);
    if (p.copyLeft !== null && p.copyRight !== null) {
      const gap = 16;
      if (slotCenter < (p.copyLeft + p.copyRight) / 2) x = clamp(p.minX, Math.min(p.maxX, p.copyLeft - p.width - gap), x);
      else x = clamp(Math.max(p.minX, p.copyRight + gap), p.maxX, x);
    }
    return { x, y: clamp(8, p.rangeHeight - p.height - 8, p.slotY + (p.slotHeight - p.height) / 2) };
  }
  const minClear = p.copyBottom !== null ? Math.max(8, p.copyBottom - Math.round(p.height * 0.12)) : 8;
  return {
    x: clamp(p.minX, p.maxX, (p.rangeWidth - p.width) / 2),
    y: clamp(minClear, p.rangeHeight - p.height - 8, p.rangeHeight * 0.52 - p.height / 2),
  };
}
