import {expect, it} from "vitest";
import {emptyCompanyDraft} from "@/lib/company-draft";
import {emptyBusiness} from "@/lib/demo-state";
import {setupDraftSaveDecision} from "./setup-draft-autosave";

const fresh=()=>({...emptyCompanyDraft("owner"),businessBaseline:{...emptyBusiness}});
it("opening untouched setup does not create an empty save or claim saved content",()=>{
 expect(setupDraftSaveDecision(fresh(),null)).toMatchObject({needed:false,hasContent:false});
});
it("a real edit must be saved, then an unchanged receipt must not be saved again",()=>{
 const edited={...fresh(),business:{...emptyBusiness,name:"New business"}};
 const first=setupDraftSaveDecision(edited,null);
 expect(first).toMatchObject({needed:true,hasContent:true});
 expect(setupDraftSaveDecision(edited,first.fingerprint).needed).toBe(false);
});
it("loading a previously saved empty draft does not show saved user content",()=>{
 const baseline=setupDraftSaveDecision(fresh(),null).fingerprint;
 expect(setupDraftSaveDecision(fresh(),baseline)).toMatchObject({needed:false,hasContent:false});
});
it("a restored unsaved local edit differs from the authoritative saved receipt",()=>{
 const baseline=setupDraftSaveDecision(fresh(),null).fingerprint;
 expect(setupDraftSaveDecision({...fresh(),business:{...emptyBusiness,name:"Recovered"}},baseline).needed).toBe(true);
});
it("JSON field order and unrelated UI progress do not create a write",()=>{
 const draft=fresh(),baseline=setupDraftSaveDecision(draft,null).fingerprint;
 const reordered={...draft,business:Object.fromEntries(Object.entries(draft.business).reverse()),setupDone:[true,true]};
 expect(setupDraftSaveDecision(reordered,baseline).needed).toBe(false);
});
it("clearing an edit still writes when an earlier in-flight edit has committed",()=>{
 const committed=setupDraftSaveDecision({...fresh(),business:{...emptyBusiness,name:"Earlier edit"}},null).fingerprint;
 expect(setupDraftSaveDecision(fresh(),committed)).toMatchObject({needed:true,hasContent:false});
});
