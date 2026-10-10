import { describe, expect, it, vi } from "vitest";
import { canBindNouraBasicTestDraft, publishReviewedDraft } from "./publication";
const id = "11111111-1111-1111-1111-111111111111";
const draft = {versionId:id,status:"draft" as const,code:"noor_basic" as const,currency:"OMR" as const,amount_baisa:45000,period_unit:"month" as const,period_count:1 as const,automated_outbound_per_month:500,feature_availability:{}};
const success = (revision:number) => ({ok:true as const,data:{version_id:id,revision}});
function ports() { return {bind:vi.fn().mockResolvedValue(success(8)),publish:vi.fn().mockResolvedValue(success(9))}; }
describe("reviewed catalog publication", () => {
 it("uses the binding revision for publication", async () => {
  const p=ports(); const result=await publishReviewedDraft(draft,7,true,p);
  expect(p.bind).toHaveBeenCalledWith(id,7); expect(p.publish).toHaveBeenCalledWith(id,8);
  expect(result).toEqual({ok:true,bindingConfirmed:true});
 });
 it("stops when owner binding is forbidden", async () => {
  const p=ports();p.bind.mockResolvedValue({ok:false,code:"forbidden"});
  expect(await publishReviewedDraft(draft,7,true,p)).toEqual({ok:false,code:"forbidden",bindingConfirmed:false});
  expect(p.publish).not.toHaveBeenCalled();
 });
 it("reports the saved binding when publication conflicts", async () => {
  const p=ports();p.publish.mockResolvedValue({ok:false,code:"conflict"});
  expect(await publishReviewedDraft(draft,7,true,p)).toEqual({ok:false,code:"conflict",bindingConfirmed:true});
  expect(p.publish).toHaveBeenCalledTimes(1);
 });
 it("rejects an unrelated binding response without publishing", async () => {
  const p=ports();p.bind.mockResolvedValue({ok:true,data:{revision:8,version_id:"22222222-2222-2222-2222-222222222222"}});
  expect(await publishReviewedDraft(draft,7,true,p)).toEqual({ok:false,code:"unavailable",bindingConfirmed:false});
  expect(p.publish).not.toHaveBeenCalled();
 });
 it("rejects stale binding revisions", async () => {
  const p=ports();p.bind.mockResolvedValue(success(6));
  expect((await publishReviewedDraft(draft,7,true,p)).ok).toBe(false);expect(p.publish).not.toHaveBeenCalled();
 });
 it("never binds Premium or a different price to the Basic Test contract", async () => {
  const p=ports();const premium={...draft,code:"noor_premium" as const};
  expect(canBindNouraBasicTestDraft(premium)).toBe(false);
  expect(canBindNouraBasicTestDraft({...draft,amount_baisa:90000})).toBe(false);
  expect((await publishReviewedDraft(premium,7,true,p)).ok).toBe(false);expect(p.bind).not.toHaveBeenCalled();expect(p.publish).not.toHaveBeenCalled();
 });
 it("publishes a catalog-only Premium version without binding", async () => {
  const p=ports();await publishReviewedDraft({...draft,code:"noor_premium"},7,false,p);
  expect(p.bind).not.toHaveBeenCalled();expect(p.publish).toHaveBeenCalledWith(id,7);
 });
 it("preserves partial confirmation when publication throws and never retries", async () => {
  const p=ports();p.publish.mockRejectedValue(new Error("network"));
  expect(await publishReviewedDraft(draft,7,true,p)).toEqual({ok:false,code:"unavailable",bindingConfirmed:true});
  expect(p.bind).toHaveBeenCalledTimes(1);expect(p.publish).toHaveBeenCalledTimes(1);
 });
 it("rejects immutable versions before any mutation", async () => {
  const p=ports();expect((await publishReviewedDraft({...draft,status:"published"},7,false,p)).ok).toBe(false);
  expect(p.bind).not.toHaveBeenCalled();expect(p.publish).not.toHaveBeenCalled();
 });
});
