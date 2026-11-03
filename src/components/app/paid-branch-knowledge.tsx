"use client";
import {useEffect, useId, useLayoutEffect, useRef, useState, type DragEvent} from "react";
import {isPreparableKnowledgeFile, validateKnowledgeBatch} from "@/lib/knowledge/constants";
import {isApprovedForAnswers, type KnowledgeSourceRecord, type KnowledgeStatus} from "@/lib/knowledge/types";
import {
  languagesToReplyContract,
  replyContractToLanguages,
  type AiReplyLanguageCode,
  type ReplyLanguageContract,
  type ReplyLanguageSnapshot,
} from "@/lib/tenancy/reply-language-contract";
import styles from "./paid-branch-knowledge.module.css";
import {useSetupUnsavedChanges} from './paid-setup-unsaved';
type FlushHost=HTMLElement&{__veloraFlush?:()=>Promise<void>};

/** View projections supplied by the future branch-aware host, not persistence DTOs. */
export type KnowledgeViewScope = {expectedAccountId:string; companyId:string; branchId:string};
export type KnowledgePageView = {
  id:string; companyId:string; branchId:string; version:number | null; url:string;
  title?:string | null;
  status:KnowledgeStatus | null; error:string | null;
  extractedLength?:number | null;
  capabilities:{canRetry:boolean | null; canRetrain:boolean | null};
};
export type BoundKnowledgeSourceView = {branchId:string | null; source:KnowledgeSourceRecord};
export type BranchKnowledgeViewSnapshot = {
  scope:KnowledgeViewScope; version:number; branchLabel:string;
  websiteQuota:{limit:10 | 50 | null; used:number | null};
  pages:KnowledgePageView[]; files:BoundKnowledgeSourceView[]; faq:BoundKnowledgeSourceView[];
  capabilities:{canAddWebsite:boolean | null; canUploadFiles:boolean | null; canSaveText:boolean | null};
};
type CommandContext = KnowledgeViewScope & {expectedVersion:number};
export type PaidBranchKnowledgeProps = {
  locale:"ar" | "en"; scope:KnowledgeViewScope; boundaryFingerprint:string;
  snapshot:BranchKnowledgeViewSnapshot | null;
  state:{scope:KnowledgeViewScope; version:number | null; phase:"loading" | "ready" | "busy" | "saved" | "conflict" | "unavailable"};
  languageSnapshot?:ReplyLanguageSnapshot | null;
  languageState?:{phase:"loading" | "ready" | "saving" | "saved" | "conflict" | "unavailable" | "error"; version:number | null};
  isCurrent:()=>boolean;
  onReload?:()=>void|Promise<void>;
  onAddWebsite?:(input:CommandContext & {url:string; rightsAttested:true})=>void | Promise<void>;
  onUploadFiles?:(input:CommandContext & {files:File[]})=>void | Promise<void>;
  onSaveText?:(input:CommandContext & {title:string; content:string})=>void | Promise<void>;
  onSourceMutation?:(input:KnowledgeViewScope & {sourceId:string;contentVersion:number;action:"edit"|"remove";title?:string;content?:string})=>void|Promise<void>;
  onRemovePage?:(input:KnowledgeViewScope & {pageId:string;pageVersion:number})=>void|Promise<void>;
  onSourceApproval?:(input:KnowledgeViewScope & {sourceId:string;contentVersion:number;approved:boolean;reviewedContentFingerprint?:string})=>void|Promise<void>;
  onPageAction?:(input:CommandContext & {pageId:string; pageVersion:number; action:"retry" | "retrain"})=>void | Promise<void>;
  onReprocessFile?:(input:KnowledgeViewScope & {sourceId:string; expectedVersion:number})=>void | Promise<void>;
  onConfirmLanguages?:(input:KnowledgeViewScope & {expectedVersion:number; replyLanguage:ReplyLanguageContract})=>void|Promise<void>;
};
type KnowledgeInput = "website" | "files" | "faq";
type OperationTarget = KnowledgeInput | "library" | "languages";
/** Browser-side twin of knowledgeReviewFingerprint — always hashes the on-screen content. */
async function clientReviewFingerprint(source:Pick<KnowledgeSourceRecord,"content">):Promise<string|null>{
  const text=typeof source.content==="string"?source.content.trim():"";
  if(!text||typeof crypto==="undefined"||!crypto.subtle)return null;
  const digest=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest),(b)=>b.toString(16).padStart(2,"0")).join("");
}
function canReprocessStoredFile(source:KnowledgeSourceRecord):boolean{
  // Approved ready files may be reprocessed. Stuck processing uses the same
  // control for lease recovery / same-attempt replay (server decides).
  return source.status==="failed"||source.status==="ready"||source.status==="stored"||source.status==="processing"||Boolean(source.failure_code);
}
function fileFailureCopy(code:string|null|undefined,t:(a:string,e:string)=>string):string{
  if(code==="no_text")return t("رُفع الملف بنجاح، لكن استخراج النص فشل لعدم وجود نصوص قابلة للقراءة داخل المستند (مستند مصور أو خالٍ من النصوص).","File uploaded successfully, but text extraction failed because no readable text was found in the document.");
  if(code==="provider_outcome_unknown")return t("لم تتأكد نتيجة تجهيز الملف. حدّث الحالة قبل أي محاولة أخرى.","The file preparation result is unconfirmed. Refresh its status before trying again.");
  if(code==="PROVIDER_EXTRACT_DISABLED")return t("تجهيز الملف غير متاح حاليًا. حاول لاحقًا.","File preparation is currently unavailable. Try again later.");
  if(code==="attempt_lease_expired")return t("توقّف تجهيز الملف. يمكنك استئناف التجهيز.","File preparation stopped. You can resume preparation.");
  return t("رُفع الملف بنجاح، لكن تعذرت معالجة الملف.","File uploaded successfully, but file processing failed.");
}
/** Keep stored diagnostics in the record; render only localized customer guidance. */
function websiteFailureCopy(error:string,t:(a:string,e:string)=>string):string{
 const code=error.split(":",1)[0]?.trim();
 if(code==="HTTP_404")return t("لم نعثر على الصفحة. تأكد من الرابط.","The page was not found. Check its address.");
 if(code==="HTTP_401"||code==="HTTP_403")return t("هذه الصفحة تتطلب إذن دخول. استخدم صفحة متاحة للعامة.","This page requires access permission. Use a publicly accessible page.");
 if(code==="FETCH_TIMEOUT")return t("استغرقت الصفحة وقتًا طويلًا للاستجابة. حاول لاحقًا.","The page took too long to respond. Try again later.");
 if(code==="PAYLOAD_TOO_LARGE")return t("محتوى الصفحة أكبر من الحد المسموح. استخدم صفحة أصغر.","The page exceeds the content limit. Use a smaller page.");
 return t("تعذّر تجهيز الصفحة. تأكد من الرابط وحاول مجددًا.","The page could not be prepared. Check its address and try again.");
}
const sameScope = (a:KnowledgeViewScope,b:KnowledgeViewScope) => !!a.expectedAccountId && !!a.companyId && !!a.branchId &&
  a.expectedAccountId===b.expectedAccountId && a.companyId===b.companyId && a.branchId===b.branchId;
const version = (v:unknown):v is number => Number.isSafeInteger(v) && Number(v)>=0;
const knownStatus = (status:unknown):status is KnowledgeStatus => typeof status==="string" && ["draft","stored","processing","ready","failed"].includes(status);
export const branchKnowledgeViewKey = (p:PaidBranchKnowledgeProps) => JSON.stringify([p.scope.expectedAccountId,p.scope.companyId,p.scope.branchId,p.boundaryFingerprint,p.snapshot?.version]);
export function knownWebsiteQuota(quota:BranchKnowledgeViewSnapshot["websiteQuota"]):boolean {
  return (quota.limit===10 || quota.limit===50) && version(quota.used);
}
/** Accepted by this preparation UI only when the existing extractor supports it. */
export function knowledgePreparationFileError(files:readonly {name:string;size:number;type?:string}[]):string | null {
  const validation=validateKnowledgeBatch([...files]);
  if(validation)return validation;
  return files.every(file=>isPreparableKnowledgeFile(file.name)) ? null : "UNSUPPORTED_EXTRACTION";
}
function websiteDraftValid(value:string):boolean {
  if(value.length>2048)return false;
  try{const url=new URL(value);return url.protocol==="https:" && !url.username && !url.password && !url.search && !url.hash;}catch{return false;}
}
const statusLabels:Record<KnowledgeStatus,[string,string]> = {
  draft:["مسودة","Draft"],stored:["مرفوع — لم يُجهّز بعد","Stored — not prepared"],processing:["قيد المعالجة","Processing"],ready:["مجهّز","Prepared"],failed:["تعذرت المعالجة","Processing failed"],
};
function formatUpdated(value:unknown, ar:boolean):string | null {
  if(typeof value!=="string" || !value.trim())return null;
  const date=new Date(value);
  if(Number.isNaN(date.getTime()))return null;
  return new Intl.DateTimeFormat(ar?"ar":"en",{dateStyle:"medium",timeStyle:"short"}).format(date);
}
function pageExtractedText(page:KnowledgePageView):string | null {
  const extra=page as KnowledgePageView & {extractedText?:unknown; extracted_text?:unknown};
  const value=typeof extra.extractedText==="string"?extra.extractedText:typeof extra.extracted_text==="string"?extra.extracted_text:"";
  const text=value.trim();
  return text || null;
}
function pageExtractedLength(page:KnowledgePageView):number | null {
  return typeof page.extractedLength==="number" && Number.isFinite(page.extractedLength) && page.extractedLength>=0 ? page.extractedLength : null;
}

export function PaidBranchKnowledge(p:PaidBranchKnowledgeProps) {
  const ar=p.locale==="ar",t=(a:string,e:string)=>ar?a:e;
  const scoped=!!p.boundaryFingerprint && sameScope(p.scope,p.state.scope);
  if(!scoped || (p.languageSnapshot&&!sameScope(p.scope,p.languageSnapshot.scope)) || (!p.snapshot&&p.state.phase!=="loading"&&p.state.phase!=="unavailable") || (p.snapshot && (!sameScope(p.scope,p.snapshot.scope) || !version(p.snapshot.version) || p.state.version!==p.snapshot.version)))
    return <section className={styles.view} dir={ar?"rtl":"ltr"}><p role="status">{t("معرفة هذا الفرع غير متاحة. أعد تحميل بياناته.","Knowledge for this branch is unavailable. Reload its data.")}</p></section>;
 const presentation:BranchKnowledgeViewSnapshot=p.snapshot??{scope:p.scope,version:0,branchLabel:"—",websiteQuota:{limit:null,used:null},pages:[],files:[],faq:[],capabilities:{canAddWebsite:null,canUploadFiles:null,canSaveText:null}};
  return <KnowledgeForm key={JSON.stringify([p.scope,p.boundaryFingerprint])} {...p} snapshot={presentation}/>;
}

function KnowledgeForm(p:PaidBranchKnowledgeProps & {snapshot:BranchKnowledgeViewSnapshot}) {
  const ar=p.locale==="ar",t=(a:string,e:string)=>ar?a:e,id=useId();
  const [url,setUrl]=useState(""),[attested,setAttested]=useState(false),[files,setFiles]=useState<File[]>([]);
  const [question,setQuestion]=useState(""),[answer,setAnswer]=useState("");
  const [editingDraft,setEditing]=useState<{sourceId:string;contentVersion:number;title:string;content:string}|null>(null);
  const [busy,setBusy]=useState(false),[failure,setFailure]=useState<OperationTarget | null>(null),[activeOp,setActiveOp]=useState<OperationTarget | null>(null);
  const [dragging,setDragging]=useState(false);
  const [selectedLanguages,setSelectedLanguages]=useState<AiReplyLanguageCode[]>(()=>replyContractToLanguages(p.languageSnapshot?.replyLanguage));
  const [languageSourceVersion,setLanguageSourceVersion]=useState(p.languageSnapshot?.version??null);
  const mounted=useRef(false),reserved=useRef(false),dragDepth=useRef(0),rootRef=useRef<HTMLElement|null>(null);
  const editTitleRef=useRef<HTMLInputElement>(null);
  const savedEditSource=editingDraft?p.snapshot.faq.find(item=>item.branchId===p.scope.branchId&&item.source.id===editingDraft.sourceId)?.source:null;
  const editConfirmed=!!(editingDraft&&savedEditSource&&savedEditSource.content_version!==editingDraft.contentVersion&&savedEditSource.title===editingDraft.title.trim()&&savedEditSource.content===editingDraft.content.trim());
  const editing=editConfirmed?null:editingDraft;
  useLayoutEffect(()=>{if(editing?.sourceId)editTitleRef.current?.focus();},[editing?.sourceId]);
  if(p.languageSnapshot&&languageSourceVersion!==p.languageSnapshot.version){
    setLanguageSourceVersion(p.languageSnapshot.version);
    const next=replyContractToLanguages(p.languageSnapshot.replyLanguage);
    const draftContract=languagesToReplyContract(selectedLanguages);
    if(!draftContract||draftContract===p.languageSnapshot.replyLanguage)setSelectedLanguages(next);
  }
  const savedLanguageContract=p.languageSnapshot?.replyLanguage??null;
  const draftLanguageContract=languagesToReplyContract(selectedLanguages);
  // Reply language autosaves on choose so assistant trial can use it without a separate Save control.
  const dirty=!!(url||question||answer||files.length||editing);
  useSetupUnsavedChanges(dirty,p.isCurrent,p.locale);
  useLayoutEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);
  const quotaKnown=knownWebsiteQuota(p.snapshot.websiteQuota);
  // Retained snapshots are presentation only until the current read is verified.
  // Soft unavailable: keep the form usable when a verified snapshot is already on screen.
  const locked=busy || p.state.phase==="busy" || p.state.phase==="conflict" || p.state.phase==="loading" || !quotaKnown;
  const context:CommandContext={...p.scope,expectedVersion:p.snapshot.version};
  const fileError=files.length?knowledgePreparationFileError(files):null;
  const pages=p.snapshot.pages.filter(page=>page.companyId===p.scope.companyId && page.branchId===p.scope.branchId);
  const scopedSources=(items:BoundKnowledgeSourceView[],kind:"text"|"file")=>items.filter(item=>item.branchId===p.scope.branchId && item.source.company_id===p.scope.companyId && item.source.kind===kind);
  const boundFiles=scopedSources(p.snapshot.files,"file");
  const boundFaq=scopedSources(p.snapshot.faq,"text");
  const urlTrim=url.trim();
  const urlInvalid=urlTrim.length>0 && !websiteDraftValid(urlTrim);
  const urlDuplicate=!urlInvalid && urlTrim.length>0 && pages.some(page=>page.url===urlTrim);
  const canAdd=!locked && p.snapshot.capabilities.canAddWebsite===true && !!p.onAddWebsite && p.snapshot.websiteQuota.used!<p.snapshot.websiteQuota.limit! && websiteDraftValid(urlTrim) && attested;
  const canUpload=!locked && p.snapshot.capabilities.canUploadFiles===true && !!p.onUploadFiles && files.length>0 && !fileError;
  const canSaveText=!locked && p.snapshot.capabilities.canSaveText===true && !!p.onSaveText && !!question.trim() && question.trim().length<=200 && !!answer.trim();
  const canFlushEdit=!!editing&&!!editing.title.trim()&&!!editing.content.trim()&&!!p.onSourceMutation&&!locked;
  // Complete box drafts flush to the DB on Next; incomplete boxes still warn before leave.
  const flushable=canAdd||canUpload||canSaveText||canFlushEdit;
  const languagePhase=p.languageState?.phase??"unavailable";
  const languageLocked=busy || languagePhase==="saving" || languagePhase==="loading" || languagePhase==="conflict";
  async function dispatch(target:OperationTarget, callback:(()=>void|Promise<void>)|undefined, options?:{ignoreKnowledgeLock?:boolean}) {
    if(!callback || reserved.current || !p.isCurrent())return;
    if(!options?.ignoreKnowledgeLock && locked)return;
    reserved.current=true;setBusy(true);setActiveOp(target);setFailure(null);
    try{
      await callback();
      if(mounted.current && p.isCurrent() && target==="files")setFiles([]);
    }catch{if(mounted.current && p.isCurrent())setFailure(target);}
    finally{reserved.current=false;if(mounted.current && p.isCurrent()){setBusy(false);setActiveOp(null);}}
  }
  async function persistReadyDrafts(){
    if(!p.isCurrent()||reserved.current||p.state.phase==="conflict"||p.state.phase==="loading"||!quotaKnown)return;
    const jobs:Array<{target:OperationTarget;run:()=>Promise<void>;after?:()=>void}>=[];
    if(canFlushEdit&&editing&&p.onSourceMutation){
      const draft=editing;
      jobs.push({target:"faq",run:async()=>{await p.onSourceMutation?.({...p.scope,...draft,action:"edit"});},after:()=>setEditing(null)});
    }
    if(canSaveText&&p.onSaveText){
      const title=question.trim(),content=answer.trim();
      jobs.push({target:"faq",run:async()=>{await p.onSaveText?.({...context,title,content});},after:()=>{setQuestion("");setAnswer("");}});
    }
    if(canAdd&&p.onAddWebsite){
      const addUrl=urlTrim;
      jobs.push({target:"website",run:async()=>{await p.onAddWebsite?.({...context,url:addUrl,rightsAttested:true});},after:()=>{setUrl("");setAttested(false);}});
    }
    if(canUpload&&p.onUploadFiles){
      const batch=[...files];
      jobs.push({target:"files",run:async()=>{await p.onUploadFiles?.({...context,files:batch});},after:()=>setFiles([])});
    }
    if(!jobs.length)return;
    reserved.current=true;
    if(mounted.current){setBusy(true);setFailure(null);}
    try{
      for(const job of jobs){
        if(mounted.current)setActiveOp(job.target);
        await job.run();
        if(mounted.current&&p.isCurrent())job.after?.();
      }
    }catch{
      if(mounted.current&&p.isCurrent())setFailure(jobs[0]?.target??"faq");
    }finally{
      reserved.current=false;
      if(mounted.current&&p.isCurrent()){setBusy(false);setActiveOp(null);}
    }
  }
  useEffect(()=>{
    const node=rootRef.current as FlushHost|null;
    if(!node)return;
    if(flushable){
      node.dataset.setupFlush="";
      node.__veloraFlush=()=>persistReadyDrafts();
    }else{
      delete node.__veloraFlush;
      delete node.dataset.setupFlush;
    }
    return()=>{delete node.__veloraFlush;delete node.dataset.setupFlush;};
  });
  function status(value:unknown){return knownStatus(value)?statusLabels[value][ar?0:1]:t("الحالة غير معروفة","Status unknown");}
  function sourceState(source:KnowledgeSourceRecord){
    if(isApprovedForAnswers(source))return t("معتمد","Approved");
    if(source.status==="ready")return t("جاهز للمراجعة","Ready for review");
    return status(source.status);
  }
  function operationAlert(target:OperationTarget){
    if(failure!==target)return null;
    return <p role="alert" className={styles.error}>{t("تعذّر تأكيد نتيجة الطلب. حدّث الحالة قبل إعادة المحاولة.","The request result could not be confirmed. Refresh its status before retrying.")}</p>;
  }
  function chooseFiles(list:FileList | readonly File[] | null | undefined){
    if(!p.isCurrent()||reserved.current||p.state.phase==="busy")return;
    setFiles(Array.from(list??[]));
  }
  function selectReplyLanguage(next:ReplyLanguageContract){
    if(!p.isCurrent()||languageLocked)return;
    setSelectedLanguages(replyContractToLanguages(next));
    if(next===savedLanguageContract)return;
    if(!p.onConfirmLanguages||!p.languageSnapshot||p.languageSnapshot.canConfirm!==true||!Number.isSafeInteger(p.languageSnapshot.version)||p.languageSnapshot.version<1)return;
    void dispatch("languages",()=>p.onConfirmLanguages?.({...p.scope,expectedVersion:p.languageSnapshot!.version,replyLanguage:next}),{ignoreKnowledgeLock:true});
  }
  const libraryCount=pages.length+boundFiles.length+boundFaq.length;


  return <section ref={rootRef} className={styles.view} data-knowledge-studio="" data-setup-unsaved={dirty?'true':undefined} dir={ar?"rtl":"ltr"} aria-labelledby={id} aria-busy={busy || p.state.phase==="busy" || p.state.phase==="loading"}>
    <div className={styles.stage}>
    <header className={styles.header}>
      <h2 id={id}>{t("معرفة الفرع","Branch knowledge")}</h2>
    </header>
    {p.state.phase==="loading"&&p.snapshot.version===0&&<p role="status" className={styles.note}>{t("جارٍ تحميل معرفة الفرع…","Loading branch knowledge…")}</p>}
    {!quotaKnown && p.state.phase!=="loading" && <p role="status" className={styles.error}>{t("حصة صفحات الموقع غير متاحة. حدّث البيانات للمتابعة.","Website quota is unavailable. Refresh data to continue.")}</p>}
    {(p.state.phase==="unavailable"||languagePhase==="unavailable")&&p.onReload&&<p role="status">{t("البيانات المعروضة تحتاج إلى تحديث قبل الحفظ.","Refresh the displayed data before saving.")} <button type="button" onClick={()=>{if(p.isCurrent())void p.onReload?.();}}>{t("تحديث البيانات","Refresh data")}</button></p>}
    {p.state.phase==="conflict" && <p role="alert" className={styles.error}>{t("تغيّرت بيانات المعرفة. أعد التحميل وراجع التغييرات قبل المتابعة.","Knowledge data changed. Reload and review the changes before continuing.")}</p>}
    <div className={styles.shell}>
    <div className={styles.studio}>
      <div className={styles.workspace}>
        <section className={styles.languageCard} data-knowledge-languages="" aria-labelledby={`${id}-languages`}>
          <div className={styles.languageBar}>
          <h3 id={`${id}-languages`} className={styles.languageLabel}>{t("لغة الرد","Reply language")}</h3>
          <div
            className={styles.languageSegment}
            role="radiogroup"
            aria-labelledby={`${id}-languages`}
            aria-disabled={languageLocked || undefined}
            aria-busy={activeOp==="languages"||languagePhase==="saving"||undefined}
            onKeyDown={(event)=>{
              if(languageLocked||!p.isCurrent())return;
              const order:ReplyLanguageContract[]=["both","ar","en"];
              const current=draftLanguageContract && order.includes(draftLanguageContract)?draftLanguageContract:null;
              const index=current?order.indexOf(current):-1;
              let next:ReplyLanguageContract|undefined;
              if(event.key==="ArrowRight"||event.key==="ArrowLeft"){
                event.preventDefault();
                const forward=ar?event.key==="ArrowLeft":event.key==="ArrowRight";
                const from=index<0?(forward?0:order.length-1):index;
                next=order[(from+(forward?1:-1)+order.length)%order.length];
              }else if(event.key==="Home"){event.preventDefault();next=order[0];}
              else if(event.key==="End"){event.preventDefault();next=order[order.length-1];}
              if(!next)return;
              selectReplyLanguage(next);
              const group=event.currentTarget;
              queueMicrotask(()=>group.querySelector<HTMLButtonElement>(`[data-language-choice="${next}"]`)?.focus());
            }}
          >
            {([
              ["both",t("تلقائي","Automatic")],
              ["ar",t("العربية","Arabic")],
              ["en","English"],
            ] as const).map(([value,label])=>{
              const checked=draftLanguageContract===value;
              return <button
                key={value}
                type="button"
                role="radio"
                className={styles.languageChoice}
                aria-checked={checked}
                data-language-choice={value}
                data-checked={checked||undefined}
                disabled={languageLocked}
                tabIndex={languageLocked?-1:checked||(!draftLanguageContract&&value==="both")?0:-1}
                onClick={()=>selectReplyLanguage(value)}
              >
                {checked?<span className={styles.languageCheck} aria-hidden="true">✓</span>:null}
                <span>{label}</span>
              </button>;
            })}
          </div>
          </div>
          {operationAlert("languages")}
          {languagePhase==="conflict"&&<p role="alert" className={styles.error}>{t("تغيّرت لغات الرد. أعد التحميل قبل الحفظ.","Reply languages changed. Reload before saving.")}</p>}
        </section>
        <section data-panel="website" className={styles.panel} id={`${id}-panel-website`} aria-labelledby={`${id}-website`}>
          <h4 id={`${id}-website`} className={styles.sectionLabel}>{t("رابط موقع","Website link")}</h4>
          {quotaKnown && (
            <p className={styles.quota} data-website-quota="">
              <bdi dir="ltr">{p.snapshot.websiteQuota.used} / {p.snapshot.websiteQuota.limit}</bdi>
            </p>
          )}
          {operationAlert("website")}
          <form noValidate onSubmit={event=>{event.preventDefault();if(canAdd)void dispatch("website",()=>p.onAddWebsite?.({...context,url:urlTrim,rightsAttested:true}));}}>
            <fieldset disabled={busy||p.state.phase==="busy"}><legend className={styles.srOnly}>{t("إضافة صفحة","Add page")}</legend>
              <div className={styles.urlRow}>
                <label className={styles.field}><span className={styles.srOnly}>{t("رابط الصفحة","Page URL")}</span><input type="url" dir="ltr" inputMode="url" autoComplete="url" value={url} aria-invalid={urlInvalid||undefined} aria-describedby={urlTrim?`${id}-url-live`:undefined} onChange={event=>{if(p.isCurrent())setUrl(event.target.value);}} placeholder="https://example.com/about"/></label>
                <button type="submit" className={styles.primary} disabled={!canAdd}>{activeOp==="website"?t("…","…"):t("إضافة","Add")}</button>
              </div>
              {urlTrim?<p id={`${id}-url-live`} role="status" className={urlInvalid?styles.error:styles.note}>{urlInvalid?t("أدخل رابط HTTPS مباشرًا دون بيانات دخول أو معاملات تتبّع.","Enter a direct HTTPS address without login details or tracking parameters."):urlDuplicate?t("هذا الرابط مرتبط بهذا الفرع بالفعل. إضافته مرة أخرى تطلب من الخادم إعادة معالجة الصفحة الحالية.","This address is already linked to this branch. Adding it again asks the server to process the existing page."):t("الرابط صالح للإرسال.","The address is ready to submit.")}</p>:null}
              <label className={styles.check}><input type="checkbox" checked={attested} onChange={event=>{if(p.isCurrent())setAttested(event.target.checked);}}/>{t("أوافق على استخدام محتوى هذه الصفحة.","I agree to use this page’s content.")}</label>
            </fieldset>
          </form>
        </section>
        <section data-panel="files" className={styles.panel} id={`${id}-panel-files`} aria-labelledby={`${id}-files`}>
          <h4 id={`${id}-files`} className={styles.sectionLabel}>{t("إضافة ملف","Add file")}</h4>
          {operationAlert("files")}
          <form noValidate onSubmit={event=>{event.preventDefault();if(canUpload)void dispatch("files",()=>p.onUploadFiles?.({...context,files:[...files]}));}}>
            <fieldset disabled={busy||p.state.phase==="busy"}><legend className={styles.srOnly}>{t("رفع الملفات","Upload files")}</legend>
              <div className={styles.fileRow}>
                <div className={styles.drop} data-file-drop="" data-dragging={dragging||undefined} onDragEnter={event=>{event.preventDefault();dragDepth.current+=1;setDragging(true);}} onDragOver={event=>{event.preventDefault();}} onDragLeave={event=>{event.preventDefault();dragDepth.current=Math.max(0,dragDepth.current-1);if(dragDepth.current===0)setDragging(false);}} onDrop={(event:DragEvent<HTMLDivElement>)=>{event.preventDefault();dragDepth.current=0;setDragging(false);chooseFiles(event.dataTransfer?.files);}}>
                  <label className={styles.dropLabel}>{t("اسحب ملفًا أو اختر من جهازك","Drag a file or choose from your device")}<input className={styles.srOnly} type="file" multiple accept=".pdf,.txt,.docx" onChange={event=>{chooseFiles(event.target.files);event.target.value="";}}/></label>
                </div>
                <button type="submit" className={styles.primary} disabled={!canUpload}>{activeOp==="files"?t("قيد الرفع","Uploading"):t("رفع","Upload")}</button>
              </div>
              {files.length>0 && <ul className={styles.picked}>{files.map((file,index)=><li key={`${file.name}:${file.size}:${index}`} data-selected-file=""><bdi>{file.name}</bdi><span>{activeOp==="files"?t("قيد الرفع","Uploading"):t("بانتظار الرفع","Waiting to upload")}</span><button type="button" onClick={()=>{if(p.isCurrent())setFiles(current=>current.filter((_,item)=>item!==index));}}>{t("إزالة","Remove")}</button></li>)}</ul>}
              {fileError && <p role="status" className={styles.error}>{fileError==="UNSUPPORTED_EXTRACTION"?t("صيغة الملف غير مدعومة للتجهيز. استخدم PDF نصيًا أو TXT أو DOCX.","This format cannot be prepared. Use text-based PDF, TXT or DOCX."):t("تحقق من الصيغة والحجم: حتى 10MB للملف، و5 ملفات و25MB للدفعة.","Check the format and size: up to 10MB per file, 5 files and 25MB per batch.")}</p>}
            </fieldset>
          </form>
        </section>
        <section data-panel="faq" className={styles.panel} id={`${id}-panel-faq`} aria-labelledby={`${id}-faq`}>
          <h4 id={`${id}-faq`} className={styles.sectionLabel}>{t("سؤال وجواب","Q&A")}</h4>
          {operationAlert("faq")}
          {editing&&<form className={styles.editor} onSubmit={event=>{event.preventDefault();if(!locked&&editing.title.trim()&&editing.content.trim())void dispatch("faq",async()=>{await p.onSourceMutation?.({...p.scope,...editing,action:'edit'});});}}><fieldset disabled={busy||p.state.phase==="busy"}>
            <legend>{t('تعديل النص المحفوظ','Edit saved text')}</legend>
            <label className={styles.field}>{t('العنوان','Title')}<input ref={editTitleRef} value={editing.title} maxLength={200} onChange={e=>{if(p.isCurrent())setEditing({...editing,title:e.target.value});}}/></label>
            <label className={styles.field}>{t('المحتوى','Content')}<textarea value={editing.content} maxLength={20000} onChange={e=>{if(p.isCurrent())setEditing({...editing,content:e.target.value});}}/></label>
            <div className={styles.actions}><button type="submit" className={styles.primary} disabled={locked||!editing.title.trim()||!editing.content.trim()}>{t('حفظ','Save')}</button><button type="button" onClick={()=>{if(p.isCurrent())setEditing(null);}}>{t('إلغاء','Cancel')}</button></div>
          </fieldset></form>}
          <form hidden={!!editing} className={styles.editor} noValidate onSubmit={event=>{event.preventDefault();if(canSaveText)void dispatch("faq",()=>p.onSaveText?.({...context,title:question.trim(),content:answer.trim()}));}}><fieldset disabled={busy||p.state.phase==="busy"}><legend className={styles.srOnly}>{t("إضافة سؤال وجواب","Add a question and answer")}</legend>
            <div className={styles.qaRow}>
              <label className={styles.field}>{t("السؤال","Question")}<input dir="auto" value={question} maxLength={200} onChange={event=>{if(p.isCurrent())setQuestion(event.target.value);}}/></label>
              <label className={`${styles.field} ${styles.qaAnswer}`}>{t("الإجابة","Answer")}<textarea dir="auto" rows={2} maxLength={20000} value={answer} onChange={event=>{if(p.isCurrent())setAnswer(event.target.value);}}/></label>
              <button type="submit" className={styles.primary} disabled={!canSaveText}>{t("إضافة","Add")}</button>
            </div>
          </fieldset></form>
        </section>
        <details className={styles.library} data-knowledge-library="true" open>
        <summary>{t("المصادر المضافة","Added sources")}<bdi>{p.snapshot.version===0?"—":libraryCount}</bdi></summary>
        {operationAlert("library")}
        {libraryCount===0?<p className={styles.empty} role="status">{p.snapshot.version===0?t("لم يتم التحقق من المصادر بعد.","Sources have not been verified yet."):t("لا توجد مصادر مرتبطة بهذا الفرع بعد.","No sources are assigned to this branch yet.")}</p>:<ul className={styles.sources}>
          {pages.map(page=>{
            const pageReady=knownStatus(page.status) && version(page.version);
            const extracted=pageExtractedText(page);
            const extractedLength=pageExtractedLength(page);
            return <li key={`page:${page.id}`}>
              <details className={styles.sourceDetails} data-knowledge-source="page">
                <summary><strong dir="auto">{page.title?.trim()||page.url}</strong><span className={styles.pill} data-state={knownStatus(page.status)?page.status:"unknown"}>{status(page.status)}</span><small className={styles.kind}>{t("رابط","Link")}</small><span className={styles.srOnly}>{t("عرض التفاصيل","View details")}</span></summary>
                <div className={styles.sourceBody}>
              <bdi className={styles.url}>{page.url}</bdi>
              {page.error && <p className={styles.error}>{websiteFailureCopy(page.error,t)}</p>}
              {extracted?<div className={styles.extract}><span>{t("المحتوى المستخرج","Extracted content")}</span><p dir="auto" className={styles.text}>{extracted}</p></div>:extractedLength&&extractedLength>0?<p className={styles.note}>{t(`تم تجهيز الصفحة، لكن نصها الكامل غير متاح للعرض حاليًا.`,`The page was prepared, but its full text is currently unavailable to view.`)}</p>:null}
              <div className={styles.actions}>{(["retry","retrain"] as const).map(action=>{
                const permitted=pageReady && (action==="retry"?page.capabilities.canRetry:page.capabilities.canRetrain)===true;
                return <button type="button" key={action} disabled={locked || !permitted || !p.onPageAction} onClick={()=>{if(permitted && version(page.version))void dispatch("library",()=>p.onPageAction?.({...context,pageId:page.id,pageVersion:page.version!,action}));}}>{action==="retry"?t("إعادة المحاولة","Retry"):t("إعادة المعالجة","Reprocess")}</button>;
              })}{p.onRemovePage&&<button type="button" disabled={locked||!version(page.version)||page.version!<1} onClick={()=>{if(p.isCurrent()&&window.confirm(t('حذف هذه الصفحة من معرفة الفرع؟','Delete this page from branch knowledge?')))void dispatch("library",()=>p.onRemovePage?.({...p.scope,pageId:page.id,pageVersion:page.version!}));}}>{t('حذف الصفحة','Delete page')}</button>}</div>
                </div>
              </details>
            </li>;
          })}
          {[...boundFiles.map(item=>({...item,kind:"file" as const})),...boundFaq.map(item=>({...item,kind:"text" as const}))].map(({source,kind})=>{
            const updated=formatUpdated(source.updated_at,ar);
            const approved=isApprovedForAnswers(source);
            return <li key={`${kind}:${source.id}`}>
              <details className={styles.sourceDetails} data-knowledge-source={kind}>
                <summary><strong dir="auto">{source.title}</strong><span className={styles.pill} data-state={approved?"approved":source.status}>{sourceState(source)}</span><small className={styles.kind}>{kind==="file"?t("ملف","File"):t("س/ج","Q&A")}</small><span className={styles.srOnly}>{!approved&&source.status==="ready"?t("مراجعة واعتماد","Review and approve"):t("عرض التفاصيل","View details")}</span></summary>
                <div className={styles.sourceBody}>
              {kind==="file" && source.file_name && source.file_name!==source.title && <bdi>{source.file_name}</bdi>}
              {updated && <small>{t("آخر تحديث: ","Last updated: ")}<bdi>{updated}</bdi></small>}
              {kind==="text" && <p dir="auto" className={styles.text}>{source.content}</p>}
              {kind==="file" && source.content?.trim() && <div className={styles.extract}><span>{t("المحتوى المستخرج","Extracted content")}</span><p dir="auto" className={styles.text}>{source.content}</p></div>}
              {kind==='file'&&source.status==='processing'&&<p className={styles.note} role="status">{t("جارٍ تجهيز الملف. يمكنك متابعة حالته من هنا.","Preparing this file. You can check its progress here.")}</p>}
              {kind==='file'&&source.failure_code==='provider_outcome_unknown'&&<p className={styles.error} role="status">{fileFailureCopy(source.failure_code,t)}</p>}
              {(p.onSourceMutation || (kind==='file' && canReprocessStoredFile(source) && Boolean(p.onReprocessFile)))&&Number.isSafeInteger(source.content_version)&&source.content_version!>0&&<div className={styles.actions}>
                {kind==='text'&&p.onSourceMutation&&<button type="button" disabled={locked} onClick={()=>{if(!p.isCurrent())return;setEditing({sourceId:source.id,contentVersion:source.content_version!,title:source.title,content:source.content??''});}}>{t('تعديل النص','Edit text')}</button>}
                {kind==='file'&&canReprocessStoredFile(source)&&p.onReprocessFile&&source.failure_code!=='provider_outcome_unknown'&&<button type="button" disabled={locked} onClick={()=>{if(!p.isCurrent())return;void dispatch("library",()=>p.onReprocessFile?.({...p.scope,sourceId:source.id,expectedVersion:1}));}}>{source.status==="processing"?t('استرداد آمن للمعالجة','Safe processing recovery'):t('إعادة المعالجة من الملف المخزن','Reprocess from stored file')}</button>}
                {p.onSourceMutation&&<button type="button" disabled={locked} onClick={()=>{if(p.isCurrent()&&window.confirm(t('إزالة المصدر من هذا الفرع؟ سيبقى الأصل محفوظًا.','Remove this source from this branch? The original will remain stored.')))void dispatch("library",()=>p.onSourceMutation?.({...p.scope,sourceId:source.id,contentVersion:source.content_version!,action:'remove'}));}}>{t('إزالة من الفرع','Remove from branch')}</button>}
              </div>}
              {source.failure_code && source.failure_code!=='provider_outcome_unknown' && <p className={styles.error}>{kind==='file'?fileFailureCopy(source.failure_code,t):t("تعذّر تجهيز المصدر؛ راجع الملف أو المحتوى.","The source could not be prepared; review the file or content.")}</p>}
              <small>{approved?t("هذه النسخة معتمدة للإجابات","This version is approved for answers"):t("هذه النسخة غير معتمدة للإجابات","This version is not approved for answers")}</small>
              {p.onSourceApproval&&source.status==='ready'&&Number.isSafeInteger(source.content_version)&&source.content_version!>0&&<button type="button" disabled={locked} onClick={()=>void dispatch("library",async()=>{
                if(!p.isCurrent())return;
                const contentVersion=source.content_version!;
                if(approved){
                  await p.onSourceApproval?.({...p.scope,sourceId:source.id,contentVersion,approved:false});
                  return;
                }
                const reviewedContentFingerprint=await clientReviewFingerprint(source);
                if(!p.isCurrent())return;
                if(!reviewedContentFingerprint)throw new Error("knowledge_review_unconfirmed");
                await p.onSourceApproval?.({...p.scope,sourceId:source.id,contentVersion,approved:true,reviewedContentFingerprint});
              })}>{approved?t('إلغاء اعتماد هذه النسخة','Remove approval for this version'):t('اعتماد هذه النسخة لإجابات المساعد','Approve this version for assistant answers')}</button>}
                </div>
              </details>
            </li>;
          })}
        </ul>}
      </details>
      </div>
    </div>
    </div>
    {!p.onAddWebsite && !p.onUploadFiles && !p.onSaveText && !p.onPageAction && <p className={styles.note}>{t("الإجراءات غير مرتبطة بالحفظ بعد. التعديلات محلية فقط.","Actions are not connected to persistence yet. Edits are local only.")}</p>}
    </div>
  </section>;
}
