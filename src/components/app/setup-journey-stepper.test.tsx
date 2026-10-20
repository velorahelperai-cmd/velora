import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { SetupJourneyStepper } from "./setup-journey-stepper";

it.each([1, 2, 3] as const)("marks only step %i current, retaining the same three numbered labels", activeStep => {
  for (const ar of [true, false]) {
    const html = renderToStaticMarkup(createElement(SetupJourneyStepper, { ar, activeStep }));
    expect(html.match(/aria-current="step"/g)).toHaveLength(1);
    expect(html).toContain(`data-step="${activeStep}" data-active="true" aria-current="step"`);
    expect(html.match(/<li /g)).toHaveLength(3);
    expect(html).toContain(`dir="${ar ? "rtl" : "ltr"}"`);
    expect(html).toContain(ar ? "مراجعة الطلب" : "Order review");
    expect(html).not.toContain("<button");
  }
});
