import {expect,it,vi} from "vitest";
import {
 parseIdentityRecoveryCase,
 attestIdentityRecoveryEvidence,
 identityRecoveryBoundaryOk,
 type IdentityRecoveryEvidencePort,
} from "./identity-recovery";

const id="b1000000-0000-4000-8000-000000000001";

it("recovery facts bind exactly to the reviewed original native user",()=>{
 expect(parseIdentityRecoveryCase({
  id,
  userId:id,
  reason:"lost_email_and_phone",
  state:"review",
  createdAt:"2026-10-14T00:00:00Z",
  verifiedEvidence:0,
 },id)).not.toBeNull();
 expect(parseIdentityRecoveryCase({
  id,
  userId:id,
  reason:"lost_phone",
  state:"approved_for_manual_recovery",
  createdAt:"2026-10-14T00:00:00Z",
  verifiedEvidence:2,
 },"different")).toBeNull();
});

it("approved_for_manual_recovery parses as review state and never implies restored access",()=>{
 const parsed=parseIdentityRecoveryCase({
  id,
  userId:id,
  reason:"lost_phone",
  state:"approved_for_manual_recovery",
  createdAt:"2026-10-14T00:00:00Z",
  verifiedEvidence:2,
 },id);
 expect(parsed?.state).toBe("approved_for_manual_recovery");
 // Contract reminder for callers: approval ≠ Auth mutation / new session.
 expect(parsed).not.toHaveProperty("restoredAccess");
 expect(parsed).not.toHaveProperty("sessionGranted");
});

it("opaque boundary fingerprints are strict 16-hex captures",()=>{
 expect(identityRecoveryBoundaryOk("aaaaaaaaaaaaaaaa")).toBe(true);
 expect(identityRecoveryBoundaryOk("not-a-fingerprint")).toBe(false);
 expect(identityRecoveryBoundaryOk("")).toBe(false);
});

it("an unconfigured evidence producer makes zero persistence calls",async()=>{
 const port:IdentityRecoveryEvidencePort={configured:false,verify:vi.fn(),record:vi.fn()};
 expect(await attestIdentityRecoveryEvidence(port,{
  caseId:id,
  expectedUserId:id,
  source:"unknown",
  evidenceReference:"opaque-ref",
 })).toEqual({ok:false,code:"UNCONFIGURED"});
 expect(port.verify).not.toHaveBeenCalled();
 expect(port.record).not.toHaveBeenCalled();
});

it("a source response for a different identity is not attested",async()=>{
 const port:IdentityRecoveryEvidencePort={
  configured:true,
  verify:vi.fn(async()=>({verified:true,userId:"other"})),
  record:vi.fn(),
 };
 expect(await attestIdentityRecoveryEvidence(port,{
  caseId:id,
  expectedUserId:id,
  source:"approved-source",
  evidenceReference:"opaque-ref",
 })).toEqual({ok:false,code:"REVIEW_REQUIRED"});
 expect(port.record).not.toHaveBeenCalled();
});

it("invalid evidence input never reaches verify or record",async()=>{
 const port:IdentityRecoveryEvidencePort={configured:true,verify:vi.fn(),record:vi.fn()};
 expect(await attestIdentityRecoveryEvidence(port,{
  caseId:"bad",
  expectedUserId:id,
  source:"x",
  evidenceReference:"y",
 })).toEqual({ok:false,code:"INVALID_INPUT"});
 expect(port.verify).not.toHaveBeenCalled();
 expect(port.record).not.toHaveBeenCalled();
});
