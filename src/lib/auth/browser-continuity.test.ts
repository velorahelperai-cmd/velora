/**
 * WP01A C5-R4-F — browser continuity unit definitions (Cursor writes; Codex runs).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const STORAGE_KEY = "velora:wp01a:continuity:v1";

describe("ensureBrowserContinuity (C5-R4-F)", () => {
  let store: Map<string, string>;
  let cookieJar: string;

  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllGlobals();
    store = new Map();
    cookieJar = "";
    vi.stubGlobal("window", {
      isSecureContext: true,
      top: undefined as unknown,
      self: undefined as unknown,
      location: { protocol: "http:", hostname: "localhost" },
    });
    (window as { top: Window; self: Window }).top = window;
    (window as { top: Window; self: Window }).self = window;
    vi.stubGlobal("location", { protocol: "http:", hostname: "localhost" });
    vi.stubGlobal("localStorage", {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => {
        store.set(k, v);
      },
    });
    vi.stubGlobal("sessionStorage", {
      getItem: () => null,
      setItem: () => undefined,
    });
    vi.stubGlobal("document", {
      get cookie() {
        return cookieJar;
      },
      set cookie(v: string) {
        const pair = v.split(";")[0] ?? "";
        const name = pair.split("=")[0] ?? "";
        const parts = cookieJar
          ? cookieJar.split("; ").filter((p) => !p.startsWith(`${name}=`))
          : [];
        parts.push(pair);
        cookieJar = parts.join("; ");
      },
    });
    let entropy = 0;
    vi.stubGlobal("crypto", {
      randomUUID: () => "11111111-1111-4111-8111-111111111111",
      getRandomValues: (arr: Uint8Array) => {
        for (let i = 0; i < arr.length; i++) arr[i] = (entropy + i) % 256;
        entropy += 17;
        return arr;
      },
    });
    vi.stubGlobal("navigator", {
      locks: {
        request: async (
          _name: string,
          _opts: unknown,
          cb: () => Promise<unknown>,
        ) => cb(),
      },
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init?: RequestInit) => {
        if (init?.method === "POST") {
          return {
            ok: true,
            json: async () => ({ ok: true, protocolVersion: 2, lineageFingerprint: "abcd" }),
          };
        }
        return {
          ok: true,
          json: async () => ({ ok: true, hasArtifacts: false, protocolVersion: 2 }),
        };
      }),
    );
  });

  it("R4-A4-unit: missing locks → CONTINUITY_UNAVAILABLE", async () => {
    vi.stubGlobal("navigator", {});
    const { ensureBrowserContinuity } = await import("./browser-continuity");
    expect(await ensureBrowserContinuity()).toEqual({ ok: false, code: "CONTINUITY_UNAVAILABLE" });
  });

  it("C07: malformed stored record → CONTINUITY_RECOVERY_REQUIRED (no silent replace)", async () => {
    store.set(STORAGE_KEY, "{not-json");
    const { ensureBrowserContinuity } = await import("./browser-continuity");
    expect(await ensureBrowserContinuity()).toEqual({
      ok: false,
      code: "CONTINUITY_RECOVERY_REQUIRED",
    });
    expect(store.get(STORAGE_KEY)).toBe("{not-json");
  });

  it("C09: missing hasArtifacts in status → CONTINUITY_UNAVAILABLE (not enroll)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({ ok: true, protocolVersion: 2 }),
      })),
    );
    const { ensureBrowserContinuity } = await import("./browser-continuity");
    expect(await ensureBrowserContinuity()).toEqual({ ok: false, code: "CONTINUITY_UNAVAILABLE" });
    expect(store.has(STORAGE_KEY)).toBe(false);
  });

  it("R4-A1-unit: empty enroll persists one anchor", async () => {
    const { ensureBrowserContinuity } = await import("./browser-continuity");
    const r = await ensureBrowserContinuity();
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.protocolVersion).toBe(2);
      expect(r.requestNonce.length).toBeGreaterThanOrEqual(16);
    }
    const parsed = JSON.parse(String(store.get(STORAGE_KEY))) as { v: number; anchor: string };
    expect(parsed.v).toBe(2);
    expect(parsed.anchor.length).toBeGreaterThanOrEqual(40);
  });

  it("R4-A4-unit: artifacts without anchor → CONTINUITY_RECOVERY_REQUIRED", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({ ok: true, hasArtifacts: true, protocolVersion: 2 }),
      })),
    );
    const { ensureBrowserContinuity } = await import("./browser-continuity");
    expect(await ensureBrowserContinuity()).toEqual({
      ok: false,
      code: "CONTINUITY_RECOVERY_REQUIRED",
    });
  });
});

it("pending gesture nonce survives retry until its matching terminal acknowledgment",async()=>{
 vi.unstubAllGlobals();
 const values=new Map<string,string>();vi.stubGlobal("sessionStorage",{getItem:(k:string)=>values.get(k)??null,setItem:(k:string,v:string)=>values.set(k,v),removeItem:(k:string)=>values.delete(k)});
 try{const mod=await import("./browser-continuity");const n=mod.takeAuthGestureNonce("login");expect(mod.takeAuthGestureNonce("login")).toBe(n);mod.clearAuthGestureNonce("other");expect(mod.takeAuthGestureNonce("login")).toBe(n);mod.clearAuthGestureNonce(n);expect(mod.takeAuthGestureNonce("login")).not.toBe(n);}finally{vi.unstubAllGlobals();}
});

it("freshGesture issues a new verification_resend nonce instead of reusing a spent one",async()=>{
 vi.unstubAllGlobals();
 const values=new Map<string,string>();vi.stubGlobal("sessionStorage",{getItem:(k:string)=>values.get(k)??null,setItem:(k:string,v:string)=>values.set(k,v),removeItem:(k:string)=>values.delete(k)});
 try{
  const mod=await import("./browser-continuity");
  const first=mod.takeAuthGestureNonce("verification_resend");
  expect(mod.takeAuthGestureNonce("verification_resend")).toBe(first);
  expect(mod.takeAuthGestureNonce("verification_resend",{fresh:true})).not.toBe(first);
 }finally{vi.unstubAllGlobals();}
});
