"use client";
import {useId, useLayoutEffect, useRef, useState} from "react";
import {isPreparableKnowledgeFile, validateKnowledgeBatch} from "@/lib/knowledge/constants";
import {isApprovedForAnswers, type KnowledgeSourceRecord, type KnowledgeStatus} from "@/lib/knowledge/types";
import styles from "./paid-branch-knowledge.module.css";
import {useSetupUnsavedChanges} from './paid-setup-unsaved';

/** View projections supplied by the future branch-aware host, not persistence DTOs. */
export type KnowledgeViewScope = {expectedAccountId:string; companyId:string; branchId:string};
export type KnowledgePageView = {
  id:string; companyId:string; branchId:string; version:number | null; url:string;
  status:KnowledgeStatus | null; error:string | null;
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
  isCurrent:()=>boolean;
  onReload?:()=>void|Promise<void>;
  onAddWebsite?:(input:CommandContext & {url:string; rightsAttested:true})=>void | Promise<void>;
  onUploadFiles?:(input:CommandContext & {files:File[]})=>void | Promise<void>;
  onSaveText?:(input:CommandContext & {title:string; content:string})=>void | Promise<void>;
  onSourceMutation?:(input:KnowledgeViewScope & {sourceId:string;contentVersion:number;action:"edit"|"remove";title?:string;content?:string})=>void|Promise<void>;
  onRemovePage?:(input:KnowledgeViewScope & {pageId:string;pageVersion:number})=>void|Promise<void>;
  onSourceApproval?:(input:KnowledgeViewScope & {sourceId:string;contentVersion:number;approved:boolean})=>void|Promise<void>;
  onPageAction?:(input:CommandContext & {pageId:string; pageVersion:number; action:"retry" | "retrain"})=>void | Promise<void>;
};
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
  const [url,setUrl]=useState(""),[attested,setAttested]=useState(false),[files,setFiles]=useState<File[]>([]);
  const [question,setQuestion]=useState(""),[answer,setAnswer]=useState("");
  const [editingDraft,setEditing]=useState<{sourceId:string;contentVersion:number;title:string;content:string}|null>(null);
  const [busy,setBusy]=useState(false),[failed,setFailed]=useState(false);
  const mounted=useRef(false),reserved=useRef(false);
  const savedEditSource=editingDraft?p.snapshot.faq.find(item=>item.branchId===p.scope.branchId&&item.source.id===editingDraft.sourceId)?.source:null;
  const editConfirmed=!!(editingDraft&&savedEditSource&&savedEditSource.content_version!==editingDraft.contentVersion&&savedEditSource.title===editingDraft.title.trim()&&savedEditSource.content===editingDraft.content.trim());
  const editing=editConfirmed?null:editingDraft;
  const dirty=!!(url||question||answer||files.length||editing);
  useSetupUnsavedChanges(dirty,p.isCurrent,p.locale);
  useLayoutEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);
  const quotaKnown=knownWebsiteQuota(p.snapshot.websiteQuota);
  const locked=busy || p.state.phase==="busy" || p.state.phase==="conflict" || p.state.phase==="unavailable" || p.state.phase==="loading" || !quotaKnown;
  const context:CommandContext={...p.scope,expectedVersion:p.snapshot.version};
  const fileError=files.length?knowledgePreparationFileError(files):null;
  const pages=p.snapshot.pages.filter(page=>page.companyId===p.scope.companyId && page.branchId===p.scope.branchId);
  const scopedSources=(items:BoundKnowledgeSourceView[],kind:"text"|"file")=>items.filter(item=>item.branchId===p.scope.branchId && item.source.company_id===p.scope.companyId && item.source.kind===kind);
  const canAdd=!locked && p.snapshot.capabilities.canAddWebsite===true && !!p.onAddWebsite && p.snapshot.websiteQuota.used!<p.snapshot.websiteQuota.limit! && websiteDraftValid(url.trim()) && attested;
  const canUpload=!locked && p.snapshot.capabilities.canUploadFiles===true && !!p.onUploadFiles && files.length>0 && !fileError;
  const canSaveText=!locked && p.snapshot.capabilities.canSaveText===true && !!p.onSaveText && !!question.trim() && question.trim().length<=200 && !!answer.trim();
  async function dispatch(callback:(()=>void|Promise<void>)|undefined) {
    if(!callback || locked || reserved.current || !p.isCurrent())return;
    if([!!url,!!(question||answer),!!files.length].filter(Boolean).length>1&&!window.confirm(t('لديك مسودات في أكثر من قسم. قد يؤدي تحديث النسخة المحفوظة إلى فقد المسودات الأخرى. هل تريد المتابعة؟','You have drafts in multiple sections. Updating the saved version may discard the other drafts. Continue?')))return;
    reserved.current=true;setBusy(true);setFailed(false);
    try{await callback();}catch{if(mounted.current && p.isCurrent())setFailed(true);}
    finally{reserved.current=false;if(mounted.current && p.isCurrent())setBusy(false);}
  }
  function status(status:unknown){return knownStatus(status)?statusLabels[status][ar?0:1]:t("الحالة غير معروفة","Status unknown");}
  function sources(items:BoundKnowledgeSourceView[],kind:"text"|"file") {
    const list=scopedSources(items,kind);
    return list.length?<ul className={styles.sources}>{list.map(({source})=><li key={source.id}>
      <strong dir="auto">{source.title}</strong><span>{status(source.status)}</span>
      {kind==="file" && source.file_name && <bdi>{source.file_name}</bdi>}
      {kind==="text" && <p dir="auto" className={styles.text}>{source.content}</p>}
      {p.onSourceMutation&&Number.isSafeInteger(source.content_version)&&source.content_version!>0&&<div className={styles.actions}>
        {kind==='text'&&<button type="button" disabled={locked} onClick={()=>{if(p.isCurrent())setEditing({sourceId:source.id,contentVersion:source.content_version!,title:source.title,content:source.content??''});}}>{t('تعديل النص','Edit text')}</button>}
        <button type="button" disabled={locked} onClick={()=>{if(p.isCurrent()&&window.confirm(t('إزالة المصدر من هذا الفرع؟ سيبقى الأصل محفوظًا.','Remove this source from this branch? The original will remain stored.')))void dispatch(()=>p.onSourceMutation?.({...p.scope,sourceId:source.id,contentVersion:source.content_version!,action:'remove'}));}}>{t('إزالة من الفرع','Remove from branch')}</button>
      </div>}
      {source.failure_code && <p className={styles.error}>{t("تعذّر تجهيز المصدر؛ راجع الملف أو المحتوى.","The source could not be prepared; review the file or content.")}</p>}
      <small>{isApprovedForAnswers(source)?t("هذه النسخة معتمدة للإجابات","This version is approved for answers"):t("هذه النسخة غير معتمدة للإجابات","This version is not approved for answers")}</small>
      {p.onSourceApproval&&source.status==='ready'&&Number.isSafeInteger(source.content_version)&&source.content_version!>0&&<button type="button" disabled={locked} onClick={()=>void dispatch(()=>p.onSourceApproval?.({...p.scope,sourceId:source.id,contentVersion:source.content_version!,approved:!isApprovedForAnswers(source)}))}>{isApprovedForAnswers(source)?t('إلغاء اعتماد هذه النسخة','Remove approval for this version'):t('اعتماد هذه النسخة لإجابات المساعد','Approve this version for assistant answers')}</button>}
    </li>)}</ul>:<p className={styles.note}>{p.snapshot.version===0?t("لم يتم التحقق من المصادر بعد.","Sources have not been verified yet."):t("لا توجد مصادر مرتبطة بهذا الفرع في هذا القسم.","No sources are assigned to this branch in this section.")}</p>;
  }

  return <section className={styles.view} data-setup-unsaved={dirty?'true':undefined} dir={ar?"rtl":"ltr"} aria-labelledby={id} aria-busy={busy || p.state.phase==="busy"}>
  {p.state.phase==="loading"&&<p role="status">{t("جارٍ تحميل معرفة الفرع…","Loading branch knowledge…")}</p>}
  {p.state.phase==="unavailable"&&<p role="status">{t("تعذّر التحقق من البيانات. الحفظ غير مؤكد.","Data could not be verified. Saving is unconfirmed.")}</p>}
  {p.state.phase==="unavailable"&&p.onReload&&<button type="button" onClick={()=>{if(p.isCurrent())void p.onReload?.();}}>{t("إعادة المحاولة","Retry")}</button>}
    <header className={styles.header}><h2 id={id}>{t("معرفة الفرع","Branch knowledge")}</h2><p>{t("الفرع: ","Branch: ")}<bdi>{p.snapshot.branchLabel}</bdi></p></header>
    <p className={styles.note}>{t("أضف معلومات نشاطك من الموقع أو الملفات أو الأسئلة والأجوبة. تجهيز المصدر لا يعني اعتماده للإجابات ولا يفعّل ردود العملاء.","Add business information from your website, files, or questions and answers. Preparing a source does not approve it for answers or enable customer replies.")}</p>
    {!quotaKnown && <p role="status" className={styles.error}>{t("حصة صفحات الموقع غير متاحة. الإجراءات معطّلة حتى تصل البيانات الموثوقة.","Website quota is unavailable. Actions are disabled until authoritative data is available.")}</p>}
    {p.state.phase==="conflict" && <p role="alert" className={styles.error}>{t("تغيّرت بيانات المعرفة. أعد التحميل وراجع التغييرات قبل المتابعة.","Knowledge data changed. Reload and review the changes before continuing.")}</p>}
    {p.state.phase==="saved" && !url && !question && !answer && !files.length && <p role="status">{t("أكد الخادم حفظ هذه النسخة.","The server confirmed this saved version.")}</p>}
    {failed && <p role="alert" className={styles.error}>{t("تعذر إرسال الطلب. راجع الحالة الحالية قبل إعادة المحاولة.","The request could not be submitted. Review its current state before retrying.")}</p>}
    {editing&&<form onSubmit={event=>{event.preventDefault();if(!locked&&editing.title.trim()&&editing.content.trim())void dispatch(async()=>{await p.onSourceMutation?.({...p.scope,...editing,action:'edit'});});}}><fieldset disabled={busy||p.state.phase==="busy"}>
      <legend>{t('تعديل النص المحفوظ','Edit saved text')}</legend>
      <label>{t('العنوان','Title')}<input value={editing.title} maxLength={200} onChange={e=>{if(p.isCurrent())setEditing({...editing,title:e.target.value});}}/></label>
      <label>{t('المحتوى','Content')}<textarea value={editing.content} maxLength={20000} onChange={e=>{if(p.isCurrent())setEditing({...editing,content:e.target.value});}}/></label>
      <p>{t('التعديل يلغي اعتماد النسخة السابقة للإجابات.','Editing removes approval of the previous version for answers.')}</p>
      <button type="submit" disabled={locked||!editing.title.trim()||!editing.content.trim()}>{t('حفظ التعديل','Save edit')}</button>
      <button type="button" onClick={()=>{if(p.isCurrent())setEditing(null);}}>{t('إلغاء','Cancel')}</button>
    </fieldset></form>}
    <section className={styles.section} aria-labelledby={`${id}-website`}>
      <div className={styles.sectionHeading}><h3 id={`${id}-website`}>{t("الموقع الإلكتروني","Website")}</h3><span>{quotaKnown?<><bdi dir="ltr">{p.snapshot.websiteQuota.used} / {p.snapshot.websiteQuota.limit}</bdi> {t("صفحة","pages")}</>:t("الحصة غير معروفة","Quota unknown")}</span></div>
      <form noValidate onSubmit={event=>{event.preventDefault();if(canAdd)void dispatch(()=>p.onAddWebsite?.({...context,url:url.trim(),rightsAttested:true}));}}>
        <fieldset disabled={busy||p.state.phase==="busy"}><legend className={styles.srOnly}>{t("إضافة صفحة","Add page")}</legend>
          <label className={styles.field}>{t("رابط الصفحة","Page URL")}<input type="url" dir="ltr" value={url} aria-describedby={`${id}-url-help`} onChange={event=>{if(p.isCurrent())setUrl(event.target.value);}} placeholder="https://example.com/about"/></label>
          <p id={`${id}-url-help`} className={styles.note}>{t('أضف رابط HTTPS مباشرًا لصفحة تملك محتواها، من دون بيانات دخول أو معاملات تتبّع.','Use a direct HTTPS page you have permission to use, without login details or tracking parameters.')}</p>
          <label className={styles.check}><input type="checkbox" checked={attested} onChange={event=>{if(p.isCurrent())setAttested(event.target.checked);}}/>{t("لدي إذن باستخدام محتوى هذه الصفحة.","I have permission to use this page's content.")}</label>
          <button type="submit" className={styles.primary} disabled={!canAdd}>{t("إضافة الصفحة","Add page")}</button>
        </fieldset>
      </form>
      {pages.length?<ul className={styles.pages}>{pages.map(page=>{
        const pageReady=knownStatus(page.status) && version(page.version);
        return <li key={page.id}><div><bdi className={styles.url}>{page.url}</bdi><span>{status(page.status)}</span></div>
          {page.error && <p className={styles.error}>{page.error}</p>}
          <div className={styles.actions}>{(["retry","retrain"] as const).map(action=>{
            const permitted=pageReady && (action==="retry"?page.capabilities.canRetry:page.capabilities.canRetrain)===true;
            return <button type="button" key={action} disabled={locked || !permitted || !p.onPageAction} onClick={()=>{if(permitted && version(page.version))void dispatch(()=>p.onPageAction?.({...context,pageId:page.id,pageVersion:page.version!,action}));}}>{action==="retry"?t("إعادة المحاولة","Retry"):t("إعادة المعالجة","Reprocess")}</button>;
          })}{p.onRemovePage&&<button type="button" disabled={locked||!version(page.version)||page.version!<1} onClick={()=>{if(p.isCurrent()&&window.confirm(t('حذف هذه الصفحة من معرفة الفرع؟','Delete this page from branch knowledge?')))void dispatch(()=>p.onRemovePage?.({...p.scope,pageId:page.id,pageVersion:page.version!}));}}>{t('حذف الصفحة','Delete page')}</button>}</div>
        </li>;
      })}</ul>:<p className={styles.note}>{p.snapshot.version===0?t("لم يتم التحقق من المصادر بعد.","Sources have not been verified yet."):t("لا توجد صفحات مرتبطة بهذا الفرع بعد.","No pages are assigned to this branch yet.")}</p>}
    </section>
    <section className={styles.section} aria-labelledby={`${id}-files`}><h3 id={`${id}-files`}>{t("الملفات","Files")}</h3>
      <p className={styles.note}>{t("التجهيز الحالي يدعم PDF النصي وTXT وDOCX. رفع ملف لا يضمن استخراج نص منه؛ الصور والجداول غير مدعومة للتجهيز هنا.","Current preparation supports text-based PDF, TXT and DOCX. Uploading does not guarantee text extraction; images and spreadsheets cannot be prepared here.")}</p>
      <form noValidate onSubmit={event=>{event.preventDefault();if(canUpload)void dispatch(()=>p.onUploadFiles?.({...context,files:[...files]}));}}><fieldset disabled={busy||p.state.phase==="busy"}><legend className={styles.srOnly}>{t("رفع الملفات","Upload files")}</legend>
        <label className={styles.field}>{t("اختر الملفات","Choose files")}<input type="file" multiple accept=".pdf,.txt,.docx" onChange={event=>{if(p.isCurrent())setFiles(Array.from(event.target.files??[]));}}/></label>
        {fileError && <p role="status" className={styles.error}>{fileError==="UNSUPPORTED_EXTRACTION"?t("صيغة الملف غير مدعومة للتجهيز. استخدم PDF نصيًا أو TXT أو DOCX.","This format cannot be prepared. Use text-based PDF, TXT or DOCX."):t("تحقق من الصيغة والحجم: حتى 10MB للملف، و5 ملفات و25MB للدفعة.","Check the format and size: up to 10MB per file, 5 files and 25MB per batch.")}</p>}
        <button type="submit" className={styles.primary} disabled={!canUpload}>{t("رفع للتجهيز","Upload for preparation")}</button>
      </fieldset></form>{sources(p.snapshot.files,"file")}
    </section>
    <section className={styles.section} aria-labelledby={`${id}-faq`}><h3 id={`${id}-faq`}>{t("الأسئلة والأجوبة","Questions and answers")}</h3>
      <form noValidate onSubmit={event=>{event.preventDefault();if(canSaveText)void dispatch(()=>p.onSaveText?.({...context,title:question.trim(),content:answer.trim()}));}}><fieldset disabled={busy||p.state.phase==="busy"}><legend className={styles.srOnly}>{t("إضافة سؤال وجواب","Add a question and answer")}</legend>
        <label className={styles.field}>{t("السؤال","Question")}<input dir="auto" value={question} maxLength={200} onChange={event=>{if(p.isCurrent())setQuestion(event.target.value);}}/></label>
        <label className={styles.field}>{t("الإجابة","Answer")}<textarea dir="auto" rows={3} maxLength={20000} value={answer} aria-describedby={`${id}-answer-help`} onChange={event=>{if(p.isCurrent())setAnswer(event.target.value);}}/></label>
        <p id={`${id}-answer-help`} className={styles.note}>{t('اكتب الإجابة التي تريد أن يعتمد عليها المساعد. الحفظ لا يعتمد المصدر تلقائيًا للإجابات.','Write the information your assistant should use. Saving does not automatically approve the source for answers.')}</p>
        <button type="submit" className={styles.primary} disabled={!canSaveText}>{t("حفظ السؤال والجواب","Save question and answer")}</button>
      </fieldset></form>{sources(p.snapshot.faq,"text")}
    </section>
    {!p.onAddWebsite && !p.onUploadFiles && !p.onSaveText && !p.onPageAction && <p className={styles.note}>{t("الإجراءات غير مرتبطة بالحفظ بعد. التعديلات محلية فقط.","Actions are not connected to persistence yet. Edits are local only.")}</p>}
  </section>;
}
