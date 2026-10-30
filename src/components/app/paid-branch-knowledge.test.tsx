import {createElement} from "react";
import {renderToStaticMarkup} from "react-dom/server";
import {expect,it} from "vitest";
import type {KnowledgeSourceRecord} from "@/lib/knowledge/types";
import {PaidBranchKnowledge,branchKnowledgeViewKey,knownWebsiteQuota,knowledgePreparationFileError,type PaidBranchKnowledgeProps} from "./paid-branch-knowledge";
const scope={expectedAccountId:"actor",companyId:"company",branchId:"branch"};
const props:PaidBranchKnowledgeProps={locale:"en",scope,boundaryFingerprint:"capture",state:{scope,version:1,phase:"ready"},snapshot:{scope,version:1,branchLabel:"Main",websiteQuota:{limit:10,used:2},pages:[{id:"page",companyId:"company",branchId:"branch",version:3,url:"https://example.com/about",status:"failed",error:"Could not read page",capabilities:{canRetry:true,canRetrain:false}}],files:[],faq:[],capabilities:{canAddWebsite:true,canUploadFiles:true,canSaveText:true}},isCurrent:()=>true};
const render=(extra:Partial<PaidBranchKnowledgeProps>={})=>renderToStaticMarkup(createElement(PaidBranchKnowledge,{...props,...extra}));
it('offers explicit version approval for a ready bound source without approving it on render',()=>{
 const source={id:'source',company_id:'company',kind:'text',title:'Q',content:'A',status:'ready',content_version:2,approved_for_answers:false,approved_version:null} as KnowledgeSourceRecord;
 const html=render({snapshot:{...props.snapshot!,faq:[{branchId:'branch',source}]},onSourceApproval:()=>{throw Error('no render mutation');}});
 expect(html).toContain('Approve this version for assistant answers');expect(html).toContain('not approved for answers');
});
it("uses content-sensitive direction for question and answer in Arabic",()=>{
 const html=render({locale:"ar"});expect(html).toContain('<input dir="auto"');expect(html).toContain('<textarea dir="auto"');
});
it.each(["ar","en"] as const)("renders three scoped sections in %s without invoking effects",locale=>{
 const html=render({locale,onPageAction:()=>{throw Error("No render action");}});expect(html).toContain('dir="'+(locale==="ar"?"rtl":"ltr")+'"');expect(html).toContain("2 / 10");expect(html).toContain('role="tablist"');expect(html).toContain('data-knowledge-library="true"');expect(html).toContain('data-panel="website"');expect(html).toContain('data-panel="files"');expect(html).toContain('data-panel="faq"');expect(html).toContain('accept=".pdf,.txt,.docx"');expect(html).not.toContain('<script');expect(html).not.toContain('href="https://');
});
it.each([{limit:null,used:0},{limit:10,used:null},{limit:50,used:-1},{limit:20,used:0}])("fails closed for unknown or invalid quota %j",quota=>{
 expect(knownWebsiteQuota(quota as never)).toBe(false);
 const html=render({snapshot:{...props.snapshot!,websiteQuota:quota as never},onPageAction:()=>{}});
 expect(html).toContain("Website quota is unavailable");expect(html).toContain('disabled="">Retry');
});
it("uses the host premium limit and does not silently reset over-limit usage",()=>{
 expect(render({snapshot:{...props.snapshot!,websiteQuota:{limit:50,used:12}}})).toContain("12 / 50");
 expect(knownWebsiteQuota({limit:10,used:12})).toBe(true);
});
it("disables unknown page status even when a capability is true",()=>{
 const html=render({snapshot:{...props.snapshot!,pages:[{...props.snapshot!.pages[0],status:null}]},onPageAction:()=>{}});
 expect(html).toContain("Status unknown");expect(html).toContain('disabled="">Retry');
});
it("never assigns legacy or foreign sources/pages to the selected branch",()=>{
 const source={id:"legacy",company_id:"company",kind:"text",title:"PRIVATE_LEGACY",content:"PRIVATE_CONTENT",status:"ready"} as KnowledgeSourceRecord;
 const html=render({snapshot:{...props.snapshot!,faq:[{branchId:null,source},{branchId:"other",source}],pages:[{...props.snapshot!.pages[0],branchId:"other",url:"https://foreign.example"}]}});
 expect(html).not.toContain("PRIVATE");expect(html).not.toContain("foreign.example");
});
it("honors negative page capabilities without inferring retry from failed status",()=>{
 const html=render({snapshot:{...props.snapshot!,pages:[{...props.snapshot!.pages[0],capabilities:{canRetry:false,canRetrain:false}}]},onPageAction:()=>{}});
 expect(html).toContain('disabled="">Retry');expect(html).toContain('disabled="">Reprocess');
});
it.each(["png","csv","xlsx"])("rejects upload-only %s formats for preparation",ext=>{
 expect(knowledgePreparationFileError([{name:`file.${ext}`,size:20}])).toBe("UNSUPPORTED_EXTRACTION");
});
it.each(["txt","pdf","docx"])("accepts supported %s only within existing file limits",ext=>{
 expect(knowledgePreparationFileError([{name:`file.${ext}`,size:20}])).toBeNull();
 expect(knowledgePreparationFileError([{name:`file.${ext}`,size:11*1024*1024}])).toBe("TOO_LARGE");
});
it("reuses existing batch and MIME validation",()=>{
 expect(knowledgePreparationFileError(Array.from({length:6},()=>({name:"f.txt",size:10})))).toBe("BATCH_TOO_MANY");
 expect(knowledgePreparationFileError([{name:"f.txt",size:10,type:"image/png"}])).toBe("INVALID_TYPE");
});
it("does not show a customer verification-failure banner when soft-unavailable with a verified snapshot",()=>{
 const html=render({
  state:{...props.state,phase:"unavailable"},
  onUploadFiles:()=>{throw Error("no render upload");},
 });
 expect(html).not.toContain("Saving is unconfirmed");
 expect(html).not.toContain("Data could not be verified");
 expect(html).toContain("Upload for preparation");
});
it.each([{scope:{...scope,branchId:"other"}},{state:{...props.state,scope:{...scope,expectedAccountId:"other"}}},{state:{...props.state,version:2}},{snapshot:null}])("hides stale branch data %#",extra=>{
 const html=render(extra);expect(html).toContain("Knowledge for this branch is unavailable");expect(html).not.toContain("example.com");
});
it("resets form on account, branch, capture or version changes, preserving locale",()=>{
 const key=branchKnowledgeViewKey(props);for(const field of ["expectedAccountId","companyId","branchId"] as const)expect(branchKnowledgeViewKey({...props,scope:{...scope,[field]:"new"}})).not.toBe(key);
 expect(branchKnowledgeViewKey({...props,boundaryFingerprint:"new"})).not.toBe(key);expect(branchKnowledgeViewKey({...props,snapshot:{...props.snapshot!,version:2}})).not.toBe(key);expect(branchKnowledgeViewKey({...props,locale:"ar"})).toBe(key);
});

it('offers scoped edit and honest branch removal only with current source versions',()=>{
 const source={id:'source',company_id:'company',kind:'text',title:'Q',content:'A',status:'ready',content_version:2} as KnowledgeSourceRecord;
 const html=render({snapshot:{...props.snapshot!,faq:[{branchId:'branch',source}]},onSourceMutation:()=>{throw Error('no render mutation');},onRemovePage:()=>{throw Error('no render mutation');}});
 expect(html).toContain('Edit text');expect(html).toContain('Remove from branch');expect(html).toContain('Delete page');
 expect(html.match(/Edit text/g)).toHaveLength(1);expect(html.match(/Delete page/g)).toHaveLength(1);expect(html.match(/Remove from branch/g)).toHaveLength(1);
 expect(render({snapshot:{...props.snapshot!,faq:[{branchId:'other',source}]},onSourceMutation:()=>{}})).not.toContain('Edit text');
});
