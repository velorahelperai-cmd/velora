"use client";
import {useId, useLayoutEffect, useRef, useState, type DragEvent, type KeyboardEvent} from "react";
import {isPreparableKnowledgeFile, validateKnowledgeBatch} from "@/lib/knowledge/constants";
import {isApprovedForAnswers, type KnowledgeSourceRecord, type KnowledgeStatus} from "@/lib/knowledge/types";
import {
  AI_REPLY_LANGUAGE_CODES,
  languagesToReplyContract,
  replyContractToLanguages,
  replyLanguageLabel,
  type AiReplyLanguageCode,
  type ReplyLanguageContract,
  type ReplyLanguageSnapshot,
} from "@/lib/tenancy/reply-language-contract";
import styles from "./paid-branch-knowledge.module.css";
import {useSetupUnsavedChanges} from './paid-setup-unsaved';

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
  onSourceApproval?:(input:KnowledgeViewScope & {sourceId:string;contentVersion:number;approved:boolean})=>void|Promise<void>;
  onPageAction?:(input:CommandContext & {pageId:string; pageVersion:number; action:"retry" | "retrain"})=>void | Promise<void>;
  onConfirmLanguages?:(input:KnowledgeViewScope & {expectedVersion:number; replyLanguage:ReplyLanguageContract})=>void|Promise<void>;
};
type StudioTab = "website" | "files" | "faq";
type OperationTarget = StudioTab | "library" | "languages";
const TABS: StudioTab[] = ["website", "files", "faq"];
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
  if(!scoped || (!p.snapshot&&p.state.phase!=="loading"&&p.state.phase!=="unavailable") || (p.snapshot && (!sameScope(p.scope,p.snapshot.scope) || !version(p.snapshot.version) || p.state.version!==p.snapshot.version)))
    return <section className={styles.view} dir={ar?"rtl":"ltr"}><p role="status">{t("معرفة هذا الفرع غير متاحة. أعد تحميل بياناته.","Knowledge for this branch is unavailable. Reload its data.")}</p></section>;
 const presentation:BranchKnowledgeViewSnapshot=p.snapshot??{scope:p.scope,version:0,branchLabel:"—",websiteQuota:{limit:null,used:null},pages:[],files:[],faq:[],capabilities:{canAddWebsite:null,canUploadFiles:null,canSaveText:null}};
  return <KnowledgeForm key={JSON.stringify([p.scope,p.boundaryFingerprint])} {...p} snapshot={presentation}/>;
}

function KnowledgeForm(p:PaidBranchKnowledgeProps & {snapshot:BranchKnowledgeViewSnapshot}) {
  const ar=p.locale==="ar",t=(a:string,e:string)=>ar?a:e,id=useId();
  const [tab,setTab]=useState<StudioTab>("website");
  const [url,setUrl]=useState(""),[attested,setAttested]=useState(false),[files,setFiles]=useState<File[]>([]);
  const [question,setQuestion]=useState(""),[answer,setAnswer]=useState("");
  const [editingDraft,setEditing]=useState<{sourceId:string;contentVersion:number;title:string;content:string}|null>(null);
  const [busy,setBusy]=useState(false),[failure,setFailure]=useState<OperationTarget | null>(null),[activeOp,setActiveOp]=useState<OperationTarget | null>(null);
  const [dragging,setDragging]=useState(false);
  const [selectedLanguages,setSelectedLanguages]=useState<AiReplyLanguageCode[]>(()=>replyContractToLanguages(p.languageSnapshot?.replyLanguage));
  const [languageSourceVersion,setLanguageSourceVersion]=useState(p.languageSnapshot?.version??null);
  const mounted=useRef(false),reserved=useRef(false),dragDepth=useRef(0);
  const tabRefs=useRef<Record<StudioTab, HTMLButtonElement | null>>({website:null,files:null,faq:null});
  const savedEditSource=editingDraft?p.snapshot.faq.find(item=>item.branchId===p.scope.branchId&&item.source.id===editingDraft.sourceId)?.source:null;
  const editConfirmed=!!(editingDraft&&savedEditSource&&savedEditSource.content_version!==editingDraft.contentVersion&&savedEditSource.title===editingDraft.title.trim()&&savedEditSource.content===editingDraft.content.trim());
  const editing=editConfirmed?null:editingDraft;
  if(p.languageSnapshot&&languageSourceVersion!==p.languageSnapshot.version){
    setLanguageSourceVersion(p.languageSnapshot.version);
    const next=replyContractToLanguages(p.languageSnapshot.replyLanguage);
    const draftContract=languagesToReplyContract(selectedLanguages);
    if(!draftContract||draftContract===p.languageSnapshot.replyLanguage)setSelectedLanguages(next);
  }
  const savedLanguageContract=p.languageSnapshot?.replyLanguage??null;
  const draftLanguageContract=languagesToReplyContract(selectedLanguages);
  const languageDirty=!!draftLanguageContract&&draftLanguageContract!==savedLanguageContract;
  const dirty=!!(url||question||answer||files.length||editing||languageDirty);
  useSetupUnsavedChanges(dirty,p.isCurrent,p.locale);
  useLayoutEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);
  const quotaKnown=knownWebsiteQuota(p.snapshot.websiteQuota);
  // Soft unavailable: keep the form usable when a verified snapshot is already on screen.
  // Hard locks remain for busy/conflict/loading/unknown quota only.
  const locked=busy || p.state.phase==="busy" || p.state.phase==="conflict" || p.state.phase==="loading" || !quotaKnown;
  const context:CommandContext={...p.scope,expectedVersion:p.snapshot.version};
  const fileError=files.length?knowledgePreparationFileError(files):null;
  const pages=p.snapshot.pages.filter(page=>page.companyId===p.scope.companyId && page.branchId===p.scope.branchId);
  const scopedSources=(items:BoundKnowledgeSourceView[],kind:"text"|"file")=>items.filter(item=>item.branchId===p.scope.branchId && item.source.company_id===p.scope.companyId && item.source.kind===kind);
  const boundFiles=scopedSources(p.snapshot.files,"file");
  const boundFaq=scopedSources(p.snapshot.faq,"text");
  const approvedCount=[...boundFiles,...boundFaq].filter(item=>isApprovedForAnswers(item.source)).length;
  const urlTrim=url.trim();
  const urlInvalid=urlTrim.length>0 && !websiteDraftValid(urlTrim);
  const urlDuplicate=!urlInvalid && urlTrim.length>0 && pages.some(page=>page.url===urlTrim);
  const canAdd=!locked && p.snapshot.capabilities.canAddWebsite===true && !!p.onAddWebsite && p.snapshot.websiteQuota.used!<p.snapshot.websiteQuota.limit! && websiteDraftValid(urlTrim) && attested;
  const canUpload=!locked && p.snapshot.capabilities.canUploadFiles===true && !!p.onUploadFiles && files.length>0 && !fileError;
  const canSaveText=!locked && p.snapshot.capabilities.canSaveText===true && !!p.onSaveText && !!question.trim() && question.trim().length<=200 && !!answer.trim();
  const languagePhase=p.languageState?.phase??"unavailable";
  const languageLocked=busy || languagePhase==="saving" || languagePhase==="loading" || languagePhase==="conflict";
  const canSaveLanguages=!languageLocked && !!p.onConfirmLanguages && !!p.languageSnapshot && p.languageSnapshot.canConfirm===true && Number.isSafeInteger(p.languageSnapshot.version) && p.languageSnapshot.version>=1 && !!draftLanguageContract && languageDirty;
  async function dispatch(target:OperationTarget, callback:(()=>void|Promise<void>)|undefined, options?:{ignoreKnowledgeLock?:boolean}) {
    if(!callback || reserved.current || !p.isCurrent())return;
    if(!options?.ignoreKnowledgeLock && locked)return;
    if([!!url,!!(question||answer),!!files.length].filter(Boolean).length>1&&!window.confirm(t('لديك مسودات في أكثر من قسم. قد يؤدي تحديث النسخة المحفوظة إلى فقد المسودات الأخرى. هل تريد المتابعة؟','You have drafts in multiple sections. Updating the saved version may discard the other drafts. Continue?')))return;
    reserved.current=true;setBusy(true);setActiveOp(target);setFailure(null);
    try{
      await callback();
      if(mounted.current && p.isCurrent() && target==="files")setFiles([]);
    }catch{if(mounted.current && p.isCurrent())setFailure(target);}
    finally{reserved.current=false;if(mounted.current && p.isCurrent()){setBusy(false);setActiveOp(null);}}
  }
  function status(value:unknown){return knownStatus(value)?statusLabels[value][ar?0:1]:t("الحالة غير معروفة","Status unknown");}
  function sourceState(source:KnowledgeSourceRecord){
    if(isApprovedForAnswers(source))return t("معتمد","Approved");
    if(source.status==="ready")return t("جاهز للمراجعة","Ready for review");
    return status(source.status);
  }
  function operationAlert(target:OperationTarget){
    if(failure!==target)return null;
    return <p role="alert" className={styles.error}>{t("تعذر إرسال الطلب. راجع الحالة الحالية قبل إعادة المحاولة.","The request could not be submitted. Review its current state before retrying.")}</p>;
  }
  function onTabsKey(event:KeyboardEvent<HTMLDivElement>){
    if(!p.isCurrent())return;
    const index=TABS.indexOf(tab);
    let next=index;
    if(event.key==="Home")next=0;
    else if(event.key==="End")next=TABS.length-1;
    else if(event.key==="ArrowRight"||event.key==="ArrowLeft"){
      const forward=ar?event.key==="ArrowLeft":event.key==="ArrowRight";
      next=index+(forward?1:-1);
      if(next<0)next=TABS.length-1;
      if(next>=TABS.length)next=0;
    }else return;
    event.preventDefault();
    const nextTab=TABS[next]!;
    setTab(nextTab);
    tabRefs.current[nextTab]?.focus();
  }
  function chooseFiles(list:FileList | readonly File[] | null | undefined){
    if(!p.isCurrent())return;
    setFiles(Array.from(list??[]));
  }
  const approvalState=p.snapshot.version===0?"unverified":approvedCount>0?"approved":"pending";
  const approvalLabel=approvalState==="unverified"?t("الاعتماد غير متحقق بعد","Approval has not been verified yet"):approvalState==="approved"?t(`نسخ معتمدة للإجابات: ${approvedCount}`,`Approved answer versions: ${approvedCount}`):t("لا توجد نسخة معتمدة للإجابات","No version is approved for answers");
  const libraryCount=pages.length+boundFiles.length+boundFaq.length;
  const tabMeta:Record<StudioTab,string>={
    website:t("الموقع","Website"),
    files:t("الملفات","Files"),
    faq:t("أسئلة وأجوبة","Questions and answers"),
  };

  return <section className={styles.view} data-knowledge-studio="" data-setup-unsaved={dirty?'true':undefined} dir={ar?"rtl":"ltr"} aria-labelledby={id} aria-busy={busy || p.state.phase==="busy" || p.state.phase==="loading"}>
    <div className={styles.stage}>
    <header className={styles.header}>
      <p className={styles.kicker}><bdi>{p.snapshot.branchLabel}</bdi>{quotaKnown?<> · <bdi dir="ltr">{p.snapshot.websiteQuota.used} / {p.snapshot.websiteQuota.limit}</bdi></>:null}</p>
      <h2 id={id}>{t("معرفة الفرع","Branch knowledge")}</h2>
      <p className={styles.lede}>{t("أضف مصدرًا واحدًا في كل مرة — موقع أو ملف أو سؤال وجواب.","Add one source at a time — a page, a file, or a Q&A.")}</p>
      <p className={styles.badge} data-approval={approvalState}>{approvalLabel}</p>
    </header>
    {!quotaKnown && <p role="status" className={styles.error}>{t("حصة صفحات الموقع غير متاحة. الإجراءات معطّلة حتى تصل البيانات الموثوقة.","Website quota is unavailable. Actions are disabled until authoritative data is available.")}</p>}
    {p.state.phase==="conflict" && <p role="alert" className={styles.error}>{t("تغيّرت بيانات المعرفة. أعد التحميل وراجع التغييرات قبل المتابعة.","Knowledge data changed. Reload and review the changes before continuing.")}</p>}
    {failure && failure!=="library" && failure!=="languages" && tab!==failure && operationAlert(failure)}
    <section className={styles.languageCard} data-knowledge-languages="" aria-labelledby={`${id}-languages`}>
      <div className={styles.languageRow}>
        <h3 id={`${id}-languages`}>{t("لغة الرد","Reply language")}</h3>
        <div className={styles.langToggles} role="group" aria-label={t("لغات الرد","Reply languages")} aria-live="polite">
          {AI_REPLY_LANGUAGE_CODES.map(code=>{
            const selected=selectedLanguages.includes(code);
            return <button
              key={code}
              type="button"
              className={selected?styles.langOn:styles.langOff}
              aria-pressed={selected}
              disabled={languageLocked}
              title={t("عند اختيار الاثنين يتبع المساعد لغة العميل.","With both selected, the assistant follows the customer.")}
              onClick={()=>{
                if(!p.isCurrent())return;
                setSelectedLanguages(current=>selected?current.filter(item=>item!==code):[...current,code]);
              }}
            >{replyLanguageLabel(code,p.locale)}</button>;
          })}
        </div>
        <button
          type="button"
          className={styles.langSave}
          disabled={!canSaveLanguages}
          onClick={()=>{
            if(!canSaveLanguages||!draftLanguageContract||!p.languageSnapshot)return;
            void dispatch("languages",()=>p.onConfirmLanguages?.({...p.scope,expectedVersion:p.languageSnapshot!.version,replyLanguage:draftLanguageContract}),{ignoreKnowledgeLock:true});
          }}
        >
          {activeOp==="languages"||languagePhase==="saving"?t("جارٍ الحفظ…","Saving…"):t("حفظ","Save")}
        </button>
      </div>
      {operationAlert("languages")}
      {languagePhase==="conflict"&&<p role="alert" className={styles.error}>{t("تغيّرت لغات الرد. أعد التحميل قبل الحفظ.","Reply languages changed. Reload before saving.")}</p>}
      {selectedLanguages.length===0&&<p className={styles.note}>{t("اختر لغة واحدة واحدة على الأقل.","Select at least one language.")}</p>}
    </section>
    <div className={styles.shell}>
    <div className={styles.tabs} role="tablist" aria-label={t("أقسام المعرفة","Knowledge sections")} aria-orientation="horizontal" onKeyDown={onTabsKey}>
      {TABS.map(item=><button key={item} ref={node=>{tabRefs.current[item]=node;}} id={`${id}-tab-${item}`} type="button" role="tab" aria-selected={tab===item} aria-controls={`${id}-panel-${item}`} tabIndex={tab===item?0:-1} className={tab===item?styles.tabActive:styles.tab} onClick={()=>{if(p.isCurrent())setTab(item);}}>{tabMeta[item]}</button>)}
    </div>
    <div className={styles.studio}>
      <div className={styles.workspace}>
        <section hidden={tab!=="website"} data-panel="website" className={styles.panel} id={`${id}-panel-website`} role="tabpanel" aria-labelledby={`${id}-tab-website`}>
          <div className={styles.sectionHeading}><h3 id={`${id}-website`} className={styles.srOnly}>{t("الموقع الإلكتروني","Website")}</h3></div>
          {tab==="website" && operationAlert("website")}
          <form noValidate onSubmit={event=>{event.preventDefault();if(canAdd)void dispatch("website",()=>p.onAddWebsite?.({...context,url:urlTrim,rightsAttested:true}));}}>
            <fieldset disabled={busy||p.state.phase==="busy"}><legend className={styles.srOnly}>{t("إضافة صفحة","Add page")}</legend>
              <label className={styles.field}>{t("رابط الصفحة","Page URL")}<input type="url" dir="ltr" inputMode="url" autoComplete="url" value={url} aria-invalid={urlInvalid||undefined} aria-describedby={urlTrim?`${id}-url-help ${id}-url-live`:`${id}-url-help`} onChange={event=>{if(p.isCurrent())setUrl(event.target.value);}} placeholder="https://example.com/about"/></label>
              <p id={`${id}-url-help`} className={styles.note}>{t('أضف رابط HTTPS مباشرًا لصفحة تملك محتواها، من دون بيانات دخول أو معاملات تتبّع.','Use a direct HTTPS page you have permission to use, without login details or tracking parameters.')}</p>
              {urlTrim?<p id={`${id}-url-live`} role="status" className={urlInvalid?styles.error:styles.note}>{urlInvalid?t("أدخل رابط HTTPS مباشرًا دون بيانات دخول أو معاملات تتبّع.","Enter a direct HTTPS address without login details or tracking parameters."):urlDuplicate?t("هذا الرابط مرتبط بهذا الفرع بالفعل. إضافته مرة أخرى تطلب من الخادم إعادة معالجة الصفحة الحالية.","This address is already linked to this branch. Adding it again asks the server to process the existing page."):t("الرابط صالح للإرسال.","The address is ready to submit.")}</p>:null}
              <label className={styles.check}><input type="checkbox" checked={attested} onChange={event=>{if(p.isCurrent())setAttested(event.target.checked);}}/>{t("لدي إذن باستخدام محتوى هذه الصفحة.","I have permission to use this page's content.")}</label>
              <button type="submit" className={styles.primary} disabled={!canAdd}>{activeOp==="website"?t("جارٍ الإضافة…","Adding…"):t("إضافة الصفحة","Add page")}</button>
            </fieldset>
          </form>
        </section>
        <section hidden={tab!=="files"} data-panel="files" className={styles.panel} id={`${id}-panel-files`} role="tabpanel" aria-labelledby={`${id}-tab-files`}>
          <h3 id={`${id}-files`} className={styles.srOnly}>{t("الملفات","Files")}</h3>
          {tab==="files" && operationAlert("files")}
          <p className={styles.note}>{t("PDF نصي أو TXT أو DOCX — حتى 10MB للملف و5 ملفات للدفعة.","Text PDF, TXT, or DOCX — up to 10MB per file and 5 files per batch.")}</p>
          <form noValidate onSubmit={event=>{event.preventDefault();if(canUpload)void dispatch("files",()=>p.onUploadFiles?.({...context,files:[...files]}));}}>
            <fieldset disabled={busy||p.state.phase==="busy"}><legend className={styles.srOnly}>{t("رفع الملفات","Upload files")}</legend>
              <div className={styles.drop} data-file-drop="" data-dragging={dragging||undefined} onDragEnter={event=>{event.preventDefault();dragDepth.current+=1;setDragging(true);}} onDragOver={event=>{event.preventDefault();}} onDragLeave={event=>{event.preventDefault();dragDepth.current=Math.max(0,dragDepth.current-1);if(dragDepth.current===0)setDragging(false);}} onDrop={(event:DragEvent<HTMLDivElement>)=>{event.preventDefault();dragDepth.current=0;setDragging(false);chooseFiles(event.dataTransfer?.files);}}>
                <p>{t("اسحب الملفات إلى هنا، أو اخترها من جهازك.","Drag files here, or choose them from your device.")}</p>
                <label className={styles.field}>{t("اختر الملفات","Choose files")}<input type="file" multiple accept=".pdf,.txt,.docx" onChange={event=>{chooseFiles(event.target.files);event.target.value="";}}/></label>
              </div>
              {files.length>0 && <ul className={styles.picked}>{files.map((file,index)=><li key={`${file.name}:${file.size}:${index}`} data-selected-file=""><bdi>{file.name}</bdi><span>{activeOp==="files"?t("قيد الرفع","Uploading"):t("بانتظار الرفع","Waiting to upload")}</span><button type="button" onClick={()=>{if(p.isCurrent())setFiles(current=>current.filter((_,item)=>item!==index));}}>{t("إزالة من الاختيار","Remove from selection")}</button></li>)}</ul>}
              {fileError && <p role="status" className={styles.error}>{fileError==="UNSUPPORTED_EXTRACTION"?t("صيغة الملف غير مدعومة للتجهيز. استخدم PDF نصيًا أو TXT أو DOCX.","This format cannot be prepared. Use text-based PDF, TXT or DOCX."):t("تحقق من الصيغة والحجم: حتى 10MB للملف، و5 ملفات و25MB للدفعة.","Check the format and size: up to 10MB per file, 5 files and 25MB per batch.")}</p>}
              <button type="submit" className={styles.primary} disabled={!canUpload}>{activeOp==="files"?t("قيد الرفع","Uploading"):t("رفع للتجهيز","Upload for preparation")}</button>
            </fieldset>
          </form>
        </section>
        <section hidden={tab!=="faq"} data-panel="faq" className={styles.panel} id={`${id}-panel-faq`} role="tabpanel" aria-labelledby={`${id}-tab-faq`}>
          <h3 id={`${id}-faq`} className={styles.srOnly}>{t("الأسئلة والأجوبة","Questions and answers")}</h3>
          {tab==="faq" && operationAlert("faq")}
          {editing&&<form className={styles.editor} onSubmit={event=>{event.preventDefault();if(!locked&&editing.title.trim()&&editing.content.trim())void dispatch("faq",async()=>{await p.onSourceMutation?.({...p.scope,...editing,action:'edit'});});}}><fieldset disabled={busy||p.state.phase==="busy"}>
            <legend>{t('تعديل النص المحفوظ','Edit saved text')}</legend>
            <label className={styles.field}>{t('العنوان','Title')}<input value={editing.title} maxLength={200} onChange={e=>{if(p.isCurrent())setEditing({...editing,title:e.target.value});}}/></label>
            <label className={styles.field}>{t('المحتوى','Content')}<textarea value={editing.content} maxLength={20000} onChange={e=>{if(p.isCurrent())setEditing({...editing,content:e.target.value});}}/></label>
            <p className={styles.note}>{t('التعديل يلغي اعتماد النسخة السابقة للإجابات.','Editing removes approval of the previous version for answers.')}</p>
            <div className={styles.actions}><button type="submit" className={styles.primary} disabled={locked||!editing.title.trim()||!editing.content.trim()}>{t('حفظ التعديل','Save edit')}</button><button type="button" onClick={()=>{if(p.isCurrent())setEditing(null);}}>{t('إلغاء','Cancel')}</button></div>
          </fieldset></form>}
          <form className={styles.editor} noValidate onSubmit={event=>{event.preventDefault();if(canSaveText)void dispatch("faq",()=>p.onSaveText?.({...context,title:question.trim(),content:answer.trim()}));}}><fieldset disabled={busy||p.state.phase==="busy"}><legend className={styles.srOnly}>{t("إضافة سؤال وجواب","Add a question and answer")}</legend>
            <label className={styles.field}>{t("السؤال","Question")}<input dir="auto" value={question} maxLength={200} onChange={event=>{if(p.isCurrent())setQuestion(event.target.value);}}/></label>
            <label className={styles.field}>{t("الإجابة","Answer")}<textarea dir="auto" rows={4} maxLength={20000} value={answer} aria-describedby={`${id}-answer-help`} onChange={event=>{if(p.isCurrent())setAnswer(event.target.value);}}/></label>
            <p id={`${id}-answer-help`} className={styles.note}>{t('اكتب الإجابة التي تريد أن يعتمد عليها المساعد. الحفظ لا يعتمد المصدر تلقائيًا للإجابات.','Write the information your assistant should use. Saving does not automatically approve the source for answers.')}</p>
            <button type="submit" className={styles.primary} disabled={!canSaveText}>{t("حفظ السؤال والجواب","Save question and answer")}</button>
          </fieldset></form>
        </section>
      </div>
      <details className={styles.library} data-knowledge-library="true" open>
        <summary>{t("مكتبة المعرفة","Knowledge library")}<bdi>{libraryCount}</bdi></summary>
        {operationAlert("library")}
        {libraryCount===0?<p className={styles.empty} role="status">{p.snapshot.version===0?t("لم يتم التحقق من المصادر بعد.","Sources have not been verified yet."):t("لا توجد مصادر مرتبطة بهذا الفرع بعد.","No sources are assigned to this branch yet.")}</p>:<ul className={styles.sources}>
          {pages.map(page=>{
            const pageReady=knownStatus(page.status) && version(page.version);
            const extracted=pageExtractedText(page);
            const extractedLength=pageExtractedLength(page);
            return <li key={`page:${page.id}`}>
              <div className={styles.sourceTop}><strong dir="auto">{page.title?.trim()||page.url}</strong><span className={styles.pill} data-state={knownStatus(page.status)?page.status:"unknown"}>{status(page.status)}</span></div>
              <small className={styles.kind}>{t("موقع إلكتروني","Website")}</small>
              <bdi className={styles.url}>{page.url}</bdi>
              {page.error && <p className={styles.error}>{page.error}</p>}
              {extracted?<div className={styles.extract}><span>{t("المحتوى المستخرج","Extracted content")}</span><p dir="auto" className={styles.text}>{extracted}</p></div>:extractedLength&&extractedLength>0?<p className={styles.note}>{t(`استُخرج ${extractedLength} حرفًا. النص الكامل غير مضمّن في قراءة الإعداد الحالية.`,`Extracted ${extractedLength} characters. The full text is not included in the current setup read.`)}</p>:null}
              <div className={styles.actions}>{(["retry","retrain"] as const).map(action=>{
                const permitted=pageReady && (action==="retry"?page.capabilities.canRetry:page.capabilities.canRetrain)===true;
                return <button type="button" key={action} disabled={locked || !permitted || !p.onPageAction} onClick={()=>{if(permitted && version(page.version))void dispatch("library",()=>p.onPageAction?.({...context,pageId:page.id,pageVersion:page.version!,action}));}}>{action==="retry"?t("إعادة المحاولة","Retry"):t("إعادة المعالجة","Reprocess")}</button>;
              })}{p.onRemovePage&&<button type="button" disabled={locked||!version(page.version)||page.version!<1} onClick={()=>{if(p.isCurrent()&&window.confirm(t('حذف هذه الصفحة من معرفة الفرع؟','Delete this page from branch knowledge?')))void dispatch("library",()=>p.onRemovePage?.({...p.scope,pageId:page.id,pageVersion:page.version!}));}}>{t('حذف الصفحة','Delete page')}</button>}</div>
            </li>;
          })}
          {[...boundFiles.map(item=>({...item,kind:"file" as const})),...boundFaq.map(item=>({...item,kind:"text" as const}))].map(({source,kind})=>{
            const updated=formatUpdated(source.updated_at,ar);
            const approved=isApprovedForAnswers(source);
            return <li key={`${kind}:${source.id}`}>
              <div className={styles.sourceTop}><strong dir="auto">{source.title}</strong><span className={styles.pill} data-state={approved?"approved":source.status}>{sourceState(source)}</span></div>
              <small className={styles.kind}>{kind==="file"?t("ملف","File"):t("سؤال وجواب","Question and answer")}</small>
              {kind==="file" && source.file_name && <bdi>{source.file_name}</bdi>}
              {updated && <small>{t("آخر تحديث: ","Last updated: ")}<bdi>{updated}</bdi></small>}
              {kind==="text" && <p dir="auto" className={styles.text}>{source.content}</p>}
              {kind==="file" && source.content?.trim() && <div className={styles.extract}><span>{t("المحتوى المستخرج","Extracted content")}</span><p dir="auto" className={styles.text}>{source.content}</p></div>}
              {p.onSourceMutation&&Number.isSafeInteger(source.content_version)&&source.content_version!>0&&<div className={styles.actions}>
                {kind==='text'&&<button type="button" disabled={locked} onClick={()=>{if(!p.isCurrent())return;setTab("faq");setEditing({sourceId:source.id,contentVersion:source.content_version!,title:source.title,content:source.content??''});}}>{t('تعديل النص','Edit text')}</button>}
                <button type="button" disabled={locked} onClick={()=>{if(p.isCurrent()&&window.confirm(t('إزالة المصدر من هذا الفرع؟ سيبقى الأصل محفوظًا.','Remove this source from this branch? The original will remain stored.')))void dispatch("library",()=>p.onSourceMutation?.({...p.scope,sourceId:source.id,contentVersion:source.content_version!,action:'remove'}));}}>{t('إزالة من الفرع','Remove from branch')}</button>
              </div>}
              {source.failure_code && <p className={styles.error}>{t("تعذّر تجهيز المصدر؛ راجع الملف أو المحتوى.","The source could not be prepared; review the file or content.")}</p>}
              <small>{approved?t("هذه النسخة معتمدة للإجابات","This version is approved for answers"):t("هذه النسخة غير معتمدة للإجابات","This version is not approved for answers")}</small>
              {p.onSourceApproval&&source.status==='ready'&&Number.isSafeInteger(source.content_version)&&source.content_version!>0&&<button type="button" disabled={locked} onClick={()=>void dispatch("library",()=>p.onSourceApproval?.({...p.scope,sourceId:source.id,contentVersion:source.content_version!,approved:!approved}))}>{approved?t('إلغاء اعتماد هذه النسخة','Remove approval for this version'):t('اعتماد هذه النسخة لإجابات المساعد','Approve this version for assistant answers')}</button>}
            </li>;
          })}
        </ul>}
      </details>
    </div>
    </div>
    {!p.onAddWebsite && !p.onUploadFiles && !p.onSaveText && !p.onPageAction && <p className={styles.note}>{t("الإجراءات غير مرتبطة بالحفظ بعد. التعديلات محلية فقط.","Actions are not connected to persistence yet. Edits are local only.")}</p>}
    </div>
  </section>;
}
