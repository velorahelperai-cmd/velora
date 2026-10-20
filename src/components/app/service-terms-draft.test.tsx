import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ locale: "ar" }));
vi.mock("@/lib/demo-state", () => ({ useDemo: () => state }));
import { ServiceTermsDraft } from "./service-terms-draft";

it("renders every Arabic clause and the pending decisions as a non-effective RTL review", () => {
  state.locale = "ar";
  const html = renderToStaticMarkup(createElement(ServiceTermsDraft));
  expect(html).toContain('dir="rtl"');
  expect(html).toContain('data-terms-effective="false"');
  expect(html).toContain("شروط خدمة واشتراك Velora");
  expect(html).not.toContain("مسودة محلية للمراجعة — غير نافذة");
  expect(html).not.toContain("مسودة غير معتمدة وغير صالحة للنشر أو القبول التعاقدي");
  expect(html).not.toContain("DRAFT NOT FOR PUBLICATION");
  expect(html).toContain("إدخال بيانات النشاط قبل الدفع لا يُعد شراءً");
  expect(html.match(/data-terms-section=/g)).toHaveLength(18);
  expect(html.match(/data-terms-pending=/g)).toHaveLength(7);
  expect(html).not.toMatch(/<form|<button|type="submit"/);
});
it("renders a complete English LTR equivalent with draft and undecided-language notices", () => {
  state.locale = "en";
  const html = renderToStaticMarkup(createElement(ServiceTermsDraft));
  expect(html).toContain('dir="ltr"');
  expect(html).toContain("Velora Service and Subscription Terms");
  expect(html).not.toContain("Local review draft — not effective");
  expect(html).not.toContain("not finally approved");
  expect(html).not.toContain("DRAFT NOT FOR PUBLICATION");
  expect(html).toContain("prevailing language");
  expect(html).toContain("Creating a draft account");
  expect(html).toContain("No limit or exclusion applies to fraud");
  expect(html).toContain('href="#draft-section-16"');
  expect(html.match(/data-terms-section=/g)).toHaveLength(18);
  expect(html).not.toContain('data-terms-effective="true"');
});
