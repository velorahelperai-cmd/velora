import { describe, expect, it } from "vitest";
import { instagramConfig } from "./config";

describe("Instagram explicit operation flags default OFF", () => {
  it("requires an explicit supported graph version", () => {
    expect(instagramConfig({}).graphVersion).toBeNull();
    expect(instagramConfig({ INSTAGRAM_GRAPH_VERSION: "v26.0" }).graphVersion).toBe("v26.0");
    for (const version of ["v25.0", "v27.0", "26.0", "v26.0/path", " v26.0 "]) {
      expect(instagramConfig({ INSTAGRAM_GRAPH_VERSION: version }).graphVersion).toBeNull();
    }
  });
  it("supports separately controlled exact explicit flags on the pinned version", () => {
    const config = instagramConfig({ INSTAGRAM_GRAPH_VERSION: "v26.0", INSTAGRAM_ALLOW_EXTERNAL_SEND: "true", INSTAGRAM_CONNECT_ENABLED: "true", INSTAGRAM_RECEIVE_ENABLED: "true" });
    expect(config).toEqual({ graphVersion: "v26.0", connectEnabled: true, receiveEnabled: true, sendEnabled: true });
  });
  it.each(["TRUE"," true ","1",undefined])("fails closed on missing/nonexact operation flags", flag => { expect(instagramConfig({INSTAGRAM_GRAPH_VERSION:"v26.0",INSTAGRAM_CONNECT_ENABLED:flag,INSTAGRAM_RECEIVE_ENABLED:flag,INSTAGRAM_ALLOW_EXTERNAL_SEND:flag})).toMatchObject({connectEnabled:false,receiveEnabled:false,sendEnabled:false}); });
  it("requires supported graph version even with all flags",()=>{expect(instagramConfig({INSTAGRAM_CONNECT_ENABLED:"true",INSTAGRAM_RECEIVE_ENABLED:"true",INSTAGRAM_ALLOW_EXTERNAL_SEND:"true"})).toEqual({graphVersion:null,connectEnabled:false,receiveEnabled:false,sendEnabled:false});});
  it("does not reuse WhatsApp configuration or expose secrets", () => {
    const config = instagramConfig({ WHATSAPP_EMBEDDED_SIGNUP_GRAPH_VERSION: "v26.0", WHATSAPP_ACCESS_TOKEN: "synthetic-secret", INSTAGRAM_APP_SECRET: "synthetic-secret" });
    expect(config.graphVersion).toBeNull();
    expect(JSON.stringify(config)).not.toContain("synthetic-secret");
  });
});
