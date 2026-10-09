"use client";
import Script from "next/script";
import {useEffect,useRef,useState} from "react";
import {getEmbeddedSignupSetup,startEmbeddedSignup,completeEmbeddedSignup,cancelEmbeddedSignup,disconnectEmbeddedSignup} from "@/lib/whatsapp/embedded-signup-actions";
import {joinSignupSignals,parseSignupMessage,signupLoginOptions,type SignupSignals} from "@/lib/whatsapp/embedded-signup-browser";
import {useDemo} from "@/lib/demo-state";
import {Button,Field,Notice} from "./ui";
type ClientConfig={appId:string;configId:string;graphVersion:string};
type BrowserAttempt={attemptId:string;nonce:string;expiresAt:string;config:ClientConfig};
type FacebookSDK={init:(options:{appId:string;version:string;xfbml:boolean;autoLogAppEvents:boolean})=>void;login:(callback:(response:{authResponse?:{code?:string}})=>void,options:ReturnType<typeof signupLoginOptions>)=>void};
declare global{interface Window{FB?:FacebookSDK}}

export function WhatsappEmbeddedSignup({companyId,keepOnPhone=false,onConnected,onDisconnected}:{companyId:string;keepOnPhone?:boolean;onConnected?:()=>void;onDisconnected?:()=>void}){
 const {locale}=useDemo();const ar=locale==="ar";
 const [config,setConfig]=useState<ClientConfig|null>(null),[sdkReady,setSdkReady]=useState(false),[busy,setBusy]=useState(false),[prepared,setPrepared]=useState(false),[status,setStatus]=useState<string|null>(null),[pin,setPin]=useState("");
 const attempt=useRef<BrowserAttempt|null>(null),signals=useRef<SignupSignals>({}),pinRef=useRef(""),claimed=useRef(false),mounted=useRef(true);
 const text=(en:string,arabic:string)=>ar?arabic:en;
 const message=(code:string)=>code==="NEEDS_SETUP"?text("Meta connection is awaiting setup. Keeping WhatsApp on your phone needs a separately supported coexistence configuration.","الربط مع ميتا ينتظر الإعداد. إبقاء واتساب على الهاتف يحتاج إعداد التعايش المدعوم بشكل منفصل."):code==="RECONCILIATION_REQUIRED"?text("The result needs review before another connection attempt. A provider step may have completed.","تحتاج النتيجة إلى مراجعة قبل محاولة ربط جديدة. قد تكون إحدى خطوات ميتا اكتملت."):code==="CONNECTED"?text("Meta verified and connected this business number. Message testing and AI activation are separate steps.","تم التحقق من رقم النشاط وربطه عبر ميتا. اختبار الرسائل وتفعيل الذكاء الاصطناعي خطوتان منفصلتان."):code==="DISCONNECTED"?text("Disconnected. Velora has stopped using this authorization.","تم فصل الربط. توقف فيلورا عن استخدام هذا التفويض."):code==="CANCELLED"?text("Connection cancelled.","تم إلغاء الربط."):text("Connection did not complete. Check your session and Meta setup before starting again.","لم يكتمل الربط. تحقق من جلستك وإعداد ميتا قبل المحاولة مجدداً.");
 const finishRef=useRef<()=>void>(()=>{});
 finishRef.current=()=>{
  const current=attempt.current,received=signals.current;
  if(!current||claimed.current||!received.code||!received.wabaId||!received.phoneNumberId)return;
  claimed.current=true;setBusy(true);const request={attemptId:current.attemptId,nonce:current.nonce,code:received.code,wabaId:received.wabaId,phoneNumberId:received.phoneNumberId,pin:pinRef.current};
  signals.current={};pinRef.current="";setPin("");
  void completeEmbeddedSignup(request).then(result=>{if(!mounted.current)return;setStatus(result.ok?"CONNECTED":result.code);setBusy(false);setPrepared(false);attempt.current=null;if(result.ok)onConnected?.();}).catch(()=>{if(mounted.current){setStatus("RECONCILIATION_REQUIRED");setBusy(false);setPrepared(false);attempt.current=null;}});
 };
 useEffect(()=>{
  mounted.current=true;void getEmbeddedSignupSetup(companyId).then(r=>{if(!mounted.current)return;if(r.ok)setConfig({appId:r.appId,configId:r.configId,graphVersion:r.graphVersion});else setStatus(r.code);}).catch(()=>{if(mounted.current)setStatus("UNAVAILABLE");});
  function receive(event:MessageEvent){if(!attempt.current||claimed.current)return;const signal=parseSignupMessage(event.origin,event.data);if(!signal)return;if(signal.event!=="FINISH"){const current=attempt.current;signals.current={};pinRef.current="";setPin("");attempt.current=null;setPrepared(false);setBusy(false);setStatus(signal.event==="CANCEL"?"CANCELLED":signal.event==="UNSUPPORTED"?"NEEDS_SETUP":"FAILED");void cancelEmbeddedSignup({attemptId:current.attemptId,nonce:current.nonce});return;}signals.current=joinSignupSignals(signals.current,signal);finishRef.current();}
  window.addEventListener("message",receive);
  const interval=window.setInterval(()=>{const current=attempt.current;if(!current||claimed.current||Date.parse(current.expiresAt)>Date.now())return;attempt.current=null;signals.current={};pinRef.current="";setPin("");setBusy(false);setPrepared(false);setStatus("EXPIRED");void cancelEmbeddedSignup({attemptId:current.attemptId,nonce:current.nonce});},1000);
  return()=>{mounted.current=false;window.removeEventListener("message",receive);window.clearInterval(interval);const current=attempt.current;attempt.current=null;signals.current={};pinRef.current="";if(current&&!claimed.current)void cancelEmbeddedSignup({attemptId:current.attemptId,nonce:current.nonce});};
 },[companyId]);
 async function prepare(){if(busy)return;setBusy(true);setStatus(null);try{const result=await startEmbeddedSignup({companyId,keepOnPhone});if(!mounted.current)return;setBusy(false);if(!result.ok){setStatus(result.code);return;}attempt.current={attemptId:result.attemptId,nonce:result.nonce,expiresAt:result.expiresAt,config:result.config};signals.current={};claimed.current=false;pinRef.current=pin;setPrepared(true);}catch{if(mounted.current){setBusy(false);setStatus("UNAVAILABLE");}}}
 function launch(){const current=attempt.current;if(!current||!window.FB||!sdkReady||Date.parse(current.expiresAt)<=Date.now())return;setBusy(true);try{window.FB.login(response=>{const code=response.authResponse?.code;if(!mounted.current||!attempt.current||claimed.current)return;if(typeof code!=="string"||!code){void cancel();return;}signals.current=joinSignupSignals(signals.current,{code});finishRef.current();},signupLoginOptions(current.config.configId));}catch{setBusy(false);setStatus("UNAVAILABLE");}}
 async function cancel(){const current=attempt.current;attempt.current=null;signals.current={};pinRef.current="";setPin("");setPrepared(false);setBusy(false);setStatus("CANCELLED");if(current)await cancelEmbeddedSignup({attemptId:current.attemptId,nonce:current.nonce});}
 async function disconnect(){setBusy(true);try{const r=await disconnectEmbeddedSignup(companyId);setBusy(false);setStatus(r.ok?"DISCONNECTED":r.code);if(r.ok)onDisconnected?.();}catch{setBusy(false);setStatus("UNAVAILABLE");}}
 return <div className="grid gap-3 rounded-xl border border-[color:var(--color-border-soft)] p-4">
  <p className="font-medium">{text("Connect with Meta","الربط مع ميتا")}</p>
  <p className="text-sm text-[var(--color-muted-soft)]">{text("A business owner authorizes their WhatsApp account in Meta. Velora verifies the account and number before storing the authorization securely.","يفوّض مالك النشاط حساب واتساب عبر ميتا. يتحقق فيلورا من الحساب والرقم قبل حفظ التفويض بأمان.")}</p>
  {status&&<Notice tone={status==="CONNECTED"||status==="DISCONNECTED"?"info":"warn"}>{message(status)}</Notice>}
  {config&&<><Script src="https://connect.facebook.net/en_US/sdk.js" strategy="afterInteractive" onReady={()=>{if(window.FB){window.FB.init({appId:config.appId,version:config.graphVersion,xfbml:false,autoLogAppEvents:false});setSdkReady(true);}}} onError={()=>setStatus("UNAVAILABLE")}/>
   {!prepared&&<Field label={text("Six-digit WhatsApp registration PIN","رمز تسجيل واتساب المكوّن من ستة أرقام")} required hint={text("Used only for this registration; it is never saved in the browser or Velora database.","يستخدم لهذا التسجيل فقط، ولا يحفظ في المتصفح أو قاعدة بيانات فيلورا.")}>{props=><input {...props} value={pin} type="password" inputMode="numeric" autoComplete="off" maxLength={6} onChange={e=>setPin(e.target.value.replace(/\D/g,""))} disabled={busy}/>}</Field>}
   <div className="flex flex-wrap gap-2"><Button disabled={busy||!sdkReady||keepOnPhone||(!prepared&&!/^\d{6}$/.test(pin))} onClick={prepared?launch:()=>void prepare()}>{prepared?text("Continue to Meta","المتابعة إلى ميتا"):text("Prepare secure connection","إعداد الربط الآمن")}</Button>{prepared&&<Button onClick={()=>void cancel()}>{text("Cancel","إلغاء")}</Button>}</div></>}
  <div><Button disabled={busy} onClick={()=>void disconnect()}>{text("Disconnect from Velora","فصل الربط عن فيلورا")}</Button></div>
 </div>;
}
