import { describe, expect, it } from "vitest";
import { pendingSignupFromStorage, serializePendingSignup, authFlowHref } from "./auth-journey";
describe("registration return and pending email",()=>{
 const now=Date.UTC(2026,9,8,12);
 it("keeps the intended safe destination through confirmation",()=>expect(authFlowHref("/verify-email","/app/settings?tab=plan","test@example.com")).toBe("/verify-email?next=%2Fapp%2Fsettings%3Ftab%3Dplan&email=test%40example.com"));
 it("rejects external returns and auth loops",()=>{expect(authFlowHref("/login","//evil.example")).toBe("/login");expect(authFlowHref("/verify-email","/login")).toBe("/verify-email");});
 it("restores a pending email without storing a password or claiming authentication",()=>{const json=serializePendingSignup({email:"TEST@example.com",next:"/app",savedAt:now,password:"secret"} as Parameters<typeof serializePendingSignup>[0]);expect(json).not.toContain("secret");expect(pendingSignupFromStorage(json,now+1)).toEqual({email:"test@example.com",next:"/app",savedAt:now});});
 it("expires pending data after two hours",()=>{const json=serializePendingSignup({email:"test@example.com",next:"/app",savedAt:now});expect(pendingSignupFromStorage(json,now+7200000)).toBeNull();});
 it("ignores malformed and future storage",()=>{expect(pendingSignupFromStorage('{"email":',now)).toBeNull();expect(pendingSignupFromStorage(serializePendingSignup({email:"test@example.com",next:"/app",savedAt:now+1}),now)).toBeNull();});
});
