import { describe, expect, it } from "vitest";
import { createClient, tryCreateClient } from "./client";

describe("WP01A browser Auth retirement", () => {
  it("never instantiates a browser Auth client", () => {
    expect(tryCreateClient()).toBeNull();
    expect(() => createClient()).toThrow("BROWSER_SUPABASE_AUTH_DISABLED");
  });
});
