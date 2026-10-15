import {emptyCompanyDraft} from "@/lib/company-draft";
import {emptyBusiness} from "@/lib/demo-state";
import {setupDraftPayload} from "@/lib/tenancy/setup-draft";

function fingerprint(input:unknown):string|null {
 const payload=setupDraftPayload(input);
 if(!payload)return null;
 const fields=(value:object)=>Object.entries(value).sort(([a],[b])=>a.localeCompare(b));
 return JSON.stringify([fields(payload.business),fields(payload.businessBaseline??emptyBusiness),payload.setupStep]);
}

/** Compare persisted fields only; mounting and UI-only progress are not edits. */
export function setupDraftSaveDecision(input:unknown,persisted:string|null){
 const current=fingerprint(input);
 const empty=fingerprint(emptyCompanyDraft(""));
 return {fingerprint:current,hasContent:current!==null&&current!==empty,
  needed:current!==null&&current!==(persisted??empty)};
}
