export type PopupResult={kind:'completed';code:string;wabaId:string;phoneNumberId:string}|{kind:'cancelled'}|{kind:'error'};
export type PopupObservation='waiting_timeout'|'popup_closed'|'callback_without_code'|'attempt_expired'|'authority_lost'|'signal_conflict';
/** One in-memory capture per attempt. A UI deadline never grants or revokes server authority. */
export function createSignupPopupSession(options:{expiresAt:number;isCurrent:()=>boolean;onObservation?:(stage:PopupObservation)=>void;trace:(stage:string,facts?:Record<string,boolean>)=>void;signal?:AbortSignal;onCode?:(code:string)=>Promise<boolean>}) {
 let code:string|undefined,assets:{wabaId:string;phoneNumberId:string}|undefined,settled=false,waited=false,saved=!options.onCode;
 let resolve!:(result:PopupResult)=>void;
 const promise=new Promise<PopupResult>(done=>{resolve=done;});
 const observation=(stage:PopupObservation)=>{options.trace(stage,{code_received:!!code,finish_received:!!assets});options.onObservation?.(stage);};
 const finish=(result:PopupResult)=>{
  if(settled)return;settled=true;clearTimeout(soft);clearTimeout(hard);clearInterval(authority);options.signal?.removeEventListener('abort',abort);
  resolve(result);code=undefined;assets=undefined;
 };
 const valid=()=>{
  if(settled)return false;
  if(options.signal?.aborted||!options.isCurrent()){observation('authority_lost');finish({kind:'error'});return false;}
  if(!Number.isFinite(options.expiresAt)||Date.now()>=options.expiresAt){observation('attempt_expired');finish({kind:'error'});return false;}
  return true;
 };
 const ready=()=>{if(valid()&&code&&assets&&saved)finish({kind:'completed',code:options.onCode?'early-authorization':code,...assets});};
 const soft=setTimeout(()=>{if(valid()){waited=true;observation('waiting_timeout');}},5*60_000);
 const hard=setTimeout(()=>{if(!settled){observation('attempt_expired');finish({kind:'error'});}},Math.max(0,Math.min(options.expiresAt-Date.now(),2_147_483_647)));
 const authority=setInterval(()=>{valid();},500);
 const abort=()=>{if(!settled){observation('authority_lost');finish({kind:'error'});}};
 options.signal?.addEventListener('abort',abort,{once:true});
 return {promise,
  code(value:unknown){
   if(!valid())return;
   options.trace('oauth_callback_received',{code_received:typeof value==='string'&&!!value.trim(),late:waited});
   if(typeof value!=='string'||!value.trim()||value.length>4096){observation('callback_without_code');return;}
   if(code&&code!==value){observation('signal_conflict');finish({kind:'error'});return;}
   if(code===value)return;
   code=value;
   if(options.onCode){void Promise.resolve().then(()=>options.onCode!(value)).then(ok=>{if(!valid())return;if(!ok){options.trace('early_authorization_unknown');finish({kind:'error'});return;}saved=true;options.trace('early_authorization_saved');ready();},()=>{if(valid())finish({kind:'error'});});}
   else ready();
  },
  assets(value:{wabaId:string;phoneNumberId:string}){
   if(!valid())return;
   options.trace('signup_signal',{finish:true,assets_received:true,late:waited});
   if(!/^\d{1,64}$/.test(value.wabaId)||!/^\d{1,64}$/.test(value.phoneNumberId)||(assets&&(assets.wabaId!==value.wabaId||assets.phoneNumberId!==value.phoneNumberId))){observation('signal_conflict');finish({kind:'error'});return;}
   assets={wabaId:value.wabaId,phoneNumberId:value.phoneNumberId};ready();
  },
  cancelled(){if(valid()){options.trace('signup_signal',{cancel:true});finish(code||assets?{kind:'error'}:{kind:'cancelled'});}},
  error(){if(valid()){options.trace('signup_signal',{error:true});finish({kind:'error'});}},
  closed(){if(valid())observation('popup_closed');},
 };
}
