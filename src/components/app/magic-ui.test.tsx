import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, it, expect } from "vitest";
import {
  MagicCard,
  BorderBeam,
  BentoGrid,
  BentoCard,
  AnimatedBeamConnection,
} from "./magic-ui";

describe("Magic UI components", () => {
  it("renders MagicCard with children and data attributes", () => {
    const html = renderToStaticMarkup(
      <MagicCard>
        <span>Test Card Content</span>
      </MagicCard>
    );
    expect(html).toContain("Test Card Content");
    expect(html).toContain('data-interactive="true"');
  });

  it("renders BorderBeam with children", () => {
    const html = renderToStaticMarkup(
      <BorderBeam>
        <div>AI Card Content</div>
      </BorderBeam>
    );
    expect(html).toContain("AI Card Content");
  });

  it("renders BentoGrid and BentoCard with colSpan", () => {
    const html = renderToStaticMarkup(
      <BentoGrid>
        <BentoCard colSpan={8}>
          <span>Main Section</span>
        </BentoCard>
        <BentoCard colSpan={4}>
          <span>Side Section</span>
        </BentoCard>
      </BentoGrid>
    );
    expect(html).toContain("Main Section");
    expect(html).toContain("Side Section");
    expect(html).toContain("grid-column:span 8 / span 8");
    expect(html).toContain("grid-column:span 4 / span 4");
  });

  it("renders AnimatedBeamConnection with nodes and labels", () => {
    const html = renderToStaticMarkup(
      <AnimatedBeamConnection
        fromLabel="واتساب"
        fromIcon={<span>WA</span>}
        toLabel="المساعد الذكي"
        toIcon={<span>AI</span>}
      />
    );
    expect(html).toContain("واتساب");
    expect(html).toContain("المساعد الذكي");
    expect(html).toContain("Velora AI");
    expect(html).toContain("beamGradient");
  });
});
