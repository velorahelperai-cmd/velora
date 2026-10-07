import { describe, expect, it } from "vitest";
import { allowedReturnPath, safeInternalPath } from "./safe-next";

describe("allowedReturnPath platform admin vs membership", () => {
  it("rejects /app for platform admin without membership", () => {
    expect(
      allowedReturnPath("/app/conversations", {
        isPlatformAdmin: true,
        hasCompany: false,
        role: null,
      }, "/admin"),
    ).toBe("/admin");
  });

  it("allows explicit staff conversations return when membership is selected", () => {
    expect(
      allowedReturnPath("/app/conversations", {
        isPlatformAdmin: true,
        hasCompany: true,
        role: "staff",
      }, "/admin"),
    ).toBe("/app/conversations");
  });

  it("rejects staff dashboard /app even for platform admin", () => {
    expect(
      allowedReturnPath("/app", {
        isPlatformAdmin: true,
        hasCompany: true,
        role: "staff",
      }, "/admin"),
    ).toBe("/admin");
  });

  it("allows owner setup return for admin with selected company", () => {
    expect(
      allowedReturnPath("/setup", {
        isPlatformAdmin: true,
        hasCompany: true,
        role: "owner",
      }, "/admin"),
    ).toBe("/setup");
  });

  it("keeps default admin landing when next is missing", () => {
    expect(
      allowedReturnPath(null, {
        isPlatformAdmin: true,
        hasCompany: true,
        role: "staff",
      }, "/admin"),
    ).toBe("/admin");
  });

  it("still allows non-admin owner to open /setup without a company yet", () => {
    expect(
      allowedReturnPath("/setup", {
        isPlatformAdmin: false,
        hasCompany: false,
        role: null,
      }, "/setup"),
    ).toBe("/setup");
  });

  it("rejects foreign admin path for non-admins", () => {
    expect(
      allowedReturnPath("/admin", {
        isPlatformAdmin: false,
        hasCompany: true,
        role: "owner",
      }, "/app"),
    ).toBe("/app");
  });
});

describe("safeInternalPath", () => {
  it("keeps /account and rejects auth loops", () => {
    expect(safeInternalPath("/account", "/setup")).toBe("/account");
    expect(safeInternalPath("/login", "/setup")).toBe("/setup");
  });
});
