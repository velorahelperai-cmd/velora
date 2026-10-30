import {expect,it} from "vitest";
import {
  languagesToReplyContract,
  replyContractToLanguages,
  resolveReplyLocale,
} from "./reply-language-contract";

it("persists single and multi selections without forcing both", () => {
  expect(languagesToReplyContract(["ar"])).toBe("ar");
  expect(languagesToReplyContract(["en"])).toBe("en");
  expect(languagesToReplyContract(["ar", "en"])).toBe("both");
  expect(languagesToReplyContract(["en", "ar", "en"])).toBe("both");
  expect(languagesToReplyContract([])).toBeNull();
  expect(languagesToReplyContract(["fr"])).toBeNull();
});

it("round-trips legacy company values for existing tenants", () => {
  expect(replyContractToLanguages("ar")).toEqual(["ar"]);
  expect(replyContractToLanguages("en")).toEqual(["en"]);
  expect(replyContractToLanguages("both")).toEqual(["ar", "en"]);
  expect(replyContractToLanguages(null)).toEqual([]);
});

it("detects customer language only when both is allowed", () => {
  expect(resolveReplyLocale("both", "مرحبا")).toBe("ar");
  expect(resolveReplyLocale("both", "Hello")).toBe("en");
  expect(resolveReplyLocale("ar", "Hello")).toBe("ar");
  expect(resolveReplyLocale("en", "مرحبا")).toBe("en");
});
