import { describe, expect, it } from "vitest";
import { IDLE_TIMEOUT_MS, isSessionIdleExpired, sessionGuardFromRpc } from "./idle-session";
describe("two-hour server session policy",()=>{
 const now=Date.UTC(2026,9,8,12);
 it("uses exactly two hours",()=>expect(IDLE_TIMEOUT_MS).toBe(7200000));
 it("expires at the boundary, including closed-browser time",()=>{expect(isSessionIdleExpired(now-IDLE_TIMEOUT_MS,now)).toBe(true);expect(isSessionIdleExpired(now-IDLE_TIMEOUT_MS+1,now)).toBe(false);});
 it("never accepts malformed or future activity",()=>{expect(isSessionIdleExpired(NaN,now)).toBe(true);expect(isSessionIdleExpired(now+1,now)).toBe(true);});
 it("does not classify an unavailable policy as logout",()=>{expect(sessionGuardFromRpc(null,{code:"PGRST202"})).toEqual({ok:false,code:"UNAVAILABLE"});});
 it("recognizes an expired JWT without treating other JWT failures as expiry",()=>{
  for(const code of ["PGRST301","PGRST303"]) expect(sessionGuardFromRpc(null,{code,message:"JWT expired"})).toEqual({ok:false,code:"UNAUTHENTICATED",expired:true});
  expect(sessionGuardFromRpc(null,{code:"PGRST301",message:"Invalid signature"})).toEqual({ok:false,code:"UNAVAILABLE"});
 });
 it("recognizes expiry independently of a valid access token",()=>{expect(sessionGuardFromRpc({ok:false,code:"SESSION_EXPIRED"},null)).toEqual({ok:false,code:"UNAUTHENTICATED",expired:true});expect(sessionGuardFromRpc(null,{code:"42501",message:"APP_SESSION_EXPIRED"})).toEqual({ok:false,code:"UNAUTHENTICATED",expired:true});});
 it("accepts only a valid server-issued expiry",()=>{expect(sessionGuardFromRpc({ok:true,expires_at:"2026-10-08T14:00:00Z"},null)).toEqual({ok:true,expiresAt:"2026-10-08T14:00:00Z"});expect(sessionGuardFromRpc({ok:true,expires_at:"garbage"},null).ok).toBe(false);});
});

