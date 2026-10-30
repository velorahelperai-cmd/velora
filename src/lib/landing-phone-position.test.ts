import { describe, expect, it } from "vitest";
import { compactPhonePosition } from "./landing-phone-position";

describe("compact phone placement", () => {
  it.each([
    { slotX: 80, copyLeft: 320, copyRight: 620, side: "left" },
    { slotX: 370, copyLeft: 10, copyRight: 310, side: "right" },
  ])("keeps the landscape phone clear of the copy on the $side", ({ slotX, copyLeft, copyRight, side }) => {
    const { x } = compactPhonePosition({ landscape: true, rangeWidth: 636, rangeHeight: 220, width: 190, height: 200, slotX, slotWidth: 180, slotY: 10, slotHeight: 200, minX: 8, maxX: 438, copyLeft, copyRight, copyBottom: 160 });
    if (side === "left") expect(x + 190 + 16).toBeLessThanOrEqual(copyLeft);
    else expect(x).toBeGreaterThanOrEqual(copyRight + 16);
  });
  it("leaves portrait phone below the copy", () => {
    const { y } = compactPhonePosition({ landscape: false, rangeWidth: 375, rangeHeight: 700, width: 200, height: 300, slotX: 80, slotWidth: 180, slotY: 200, slotHeight: 280, minX: 8, maxX: 167, copyLeft: 10, copyRight: 365, copyBottom: 160 });
    expect(y).toBeGreaterThanOrEqual(124);
  });
});
