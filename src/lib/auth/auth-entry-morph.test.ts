import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  AUTH_ENTRY_MORPH_KEY,
  consumeAuthEntryMorph,
  markAuthEntryMorph,
} from "./auth-entry-morph";

describe("auth entry morph session flag", () => {
  const store = new Map<string, string>();

  beforeEach(() => {
    store.clear();
    vi.stubGlobal("sessionStorage", {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => {
        store.set(key, value);
      },
      removeItem: (key: string) => {
        store.delete(key);
      },
      clear: () => store.clear(),
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("marks and consumes once so hard loads stay instant", () => {
    expect(consumeAuthEntryMorph()).toBe(false);
    markAuthEntryMorph();
    expect(store.get(AUTH_ENTRY_MORPH_KEY)).toBe("1");
    expect(consumeAuthEntryMorph()).toBe(true);
    expect(consumeAuthEntryMorph()).toBe(false);
  });
});
