'use client';
import type {AutosaveStatus} from './smart-autosave';
import {Button} from './ui';
export function SmartAutosaveStatus({status,code,ar,onRetry,onReload}:{status:AutosaveStatus;code:string|null;ar:boolean;onRetry:()=>void;onReload:()=>void}){
 const text=code==='REVIEW_REQUIRED'?(ar?'تغيير الدولة يحتاج مراجعة. لم يتم حفظ هذا التغيير.':'Country changes require review. This change was not saved.'):
 code==='INVALID_INPUT'?(ar?'أكمل البيانات المطلوبة وصحح الهاتف أو البريد ليتم الحفظ.':'Complete required fields and correct the phone or email to save.'):
 code==='STORAGE_UNAVAILABLE'?(ar?'تعذر حفظ التعديلات على الجهاز. تحقق من إعدادات التخزين ثم أعد المحاولة.':'Edits could not be stored on this device. Check storage settings and retry.'):
 status==='saving'?(ar?'جارٍ الحفظ…':'Saving…'):status==='saved'?(ar?'تم الحفظ':'Saved'):status==='changed'?(ar?'تعديلات تنتظر الحفظ':'Changes waiting to save'):
 status==='offline'?(ar?'لا يوجد اتصال. التعديلات محفوظة على هذا الجهاز وتنتظر الاتصال.':'Offline. Edits are stored on this device and waiting for connection.'):
 status==='unknown'?(ar?'لم يصل تأكيد الحفظ. أعد محاولة نفس الحفظ للتأكد بأمان.':'Save confirmation did not arrive. Retry the same save safely.'):
 status==='conflict'?(ar?'تغيرت البيانات المحفوظة في جلسة أخرى. احتفظنا بتعديلاتك.':'Saved settings changed in another session. Your edits were kept.'):
 (ar?'تعذر الحفظ. تحقق من صلاحية حسابك وأعد المحاولة.':'Could not save. Check your account access and retry.');
 return <div><p role={['conflict','error'].includes(status)?'alert':'status'} aria-live="polite">{text}</p>
 {['unknown','error','offline'].includes(status)?<Button type="button" variant="secondary" onClick={onRetry}>{ar?'إعادة المحاولة':'Retry save'}</Button>:null}
 {['conflict','error'].includes(status)?<Button type="button" variant="secondary" onClick={onReload}>{ar?'استخدام أحدث البيانات المحفوظة':'Use latest saved settings'}</Button>:null}</div>;
}
