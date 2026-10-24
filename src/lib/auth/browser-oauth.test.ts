import {beforeEach,afterEach,describe,expect,it,vi} from "vitest";
const m=vi.hoisted(()=>({start:vi.fn(),assign:vi.fn()}));
vi.mock("./broker-actions",()=>({startOAuthAction:m.start}));
vi.mock("./browser-continuity",async original=>{
 const actual=await original<typeof import("./browser-continuity")>();
 return {...actual,ensureBrowserContinuity:async()=>({ok:true,requestNonce:actual.takeAuthGestureNonce()})};
});
import {startOAuth} from "./browser";
import {peekAuthGestureNonce} from "./browser-continuity";
beforeEach(()=>{
 vi.resetAllMocks();const storage=new Map<string,string>();
 vi.stubGlobal("sessionStorage",{getItem:(key:string)=>storage.get(key)??null,setItem:(key:string,value:string)=>storage.set(key,value),removeItem:(key:string)=>storage.delete(key)});
 vi.stubGlobal("window",{location:{assign:m.assign}});
});
afterEach(()=>vi.unstubAllGlobals());
describe("Google gesture lifecycle",()=>{
 it("starts a new gesture after the server confirms the prior intent can be superseded",async()=>{
  m.start.mockResolvedValueOnce({ok:true,url:"https://provider.example/first"});await startOAuth();
  const first=peekAuthGestureNonce();
  m.start.mockResolvedValueOnce({ok:false,code:"OAUTH_NEW_INTENT_REQUIRED"}).mockResolvedValueOnce({ok:true,url:"https://provider.example/second"});
  await startOAuth();
  expect(m.start).toHaveBeenCalledTimes(3);expect(m.start.mock.calls[1][2]).toBe(first);
  expect(m.start.mock.calls[2][2]).not.toBe(first);expect(m.assign).toHaveBeenLastCalledWith("https://provider.example/second");
 });
 it("preserves the same gesture when provider exchange is UNKNOWN",async()=>{
  m.start.mockResolvedValue({ok:false,code:"UNAVAILABLE"});
  await expect(startOAuth()).rejects.toThrow("OAUTH_UNAVAILABLE");const nonce=peekAuthGestureNonce();
  await expect(startOAuth()).rejects.toThrow("OAUTH_UNAVAILABLE");
  expect(m.start.mock.calls[1][2]).toBe(nonce);expect(peekAuthGestureNonce()).toBe(nonce);expect(m.assign).not.toHaveBeenCalled();
 });
 it("does not loop when the fresh attempt cannot start",async()=>{
  m.start.mockResolvedValue({ok:false,code:"OAUTH_NEW_INTENT_REQUIRED"});
  await expect(startOAuth()).rejects.toThrow("OAUTH_UNAVAILABLE");expect(m.start).toHaveBeenCalledTimes(2);expect(m.assign).not.toHaveBeenCalled();
 });
});
