import { afterEach, expect, it, vi } from "vitest";
vi.mock("@/components/app/workspace-pages", () => ({ LegalPage: () => null }));
vi.mock("@/components/app/service-terms-draft", () => ({ ServiceTermsDraft: () => null }));
import Page from "./page";

afterEach(() => vi.unstubAllEnvs());
it("loads the review-only content inside the existing legal layout in development", async () => {
  vi.stubEnv("NODE_ENV", "development");
  const page = await Page();
  expect(page.props.kind).toBe("terms");
  expect(page.props.draftTerms).toBe(true);
  expect(page.props.children).toBeTruthy();
});
it("keeps production on the original legal page without draft content or acceptance binding", async () => {
  vi.stubEnv("NODE_ENV", "production");
  const page = await Page();
  expect(page.props.kind).toBe("terms");
  expect(page.props.draftTerms).toBeUndefined();
  expect(page.props.children).toBeUndefined();
});
