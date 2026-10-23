import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { AuthMotionCanvas } from "./auth-motion-canvas";

it("exports a client canvas backdrop that respects reduced motion and visibility", () => {
  expect(typeof AuthMotionCanvas).toBe("function");
  const source = readFileSync(new URL("./auth-motion-canvas.tsx", import.meta.url), "utf8");
  expect(source).toContain('"use client"');
  expect(source).toContain("prefers-reduced-motion");
  expect(source).toContain("visibilitychange");
  expect(source).toContain("pointer-events-none");
  expect(source).toContain("aria-hidden");
  expect(source).not.toContain("setTimeout");
});
