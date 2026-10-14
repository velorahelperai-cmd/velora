export type AutosaveReceipt<T>={value:T;revision:number;digest:string};
export type AutosaveAttempt<T>={id:string;value:T;revision:number;digest:string};
export type AutosaveResult<T>={ok:true;data:AutosaveReceipt<T>}|{ok:false;code:string};
export type AutosaveStatus='saved'|'changed'|'saving'|'offline'|'unknown'|'conflict'|'error';
type StoragePort=Pick<Storage,'getItem'|'setItem'|'removeItem'>;
type State<T>=AutosaveReceipt<T>&{baseline:T;status:AutosaveStatus;code:string|null};
const canonical=(v:unknown):string=>JSON.stringify(v,(_key,value)=>value&&typeof value==='object'&&!Array.isArray(value)?Object.fromEntries(Object.keys(value).sort().map(k=>[k,value[k]])):value);
const equal=(a:unknown,b:unknown)=>canonical(a)===canonical(b);
/** Only database settings writes belong here. Attempts survive reload and replay unchanged. */
export class SmartAutosave<T>{
 readonly key:string;state:State<T>;private attempt:AutosaveAttempt<T>|null=null;private live=true;private busy=false;
 constructor(private options:{scope:string;value:T;revision:number;digest:string;storage:StoragePort;save:(attempt:AutosaveAttempt<T>)=>Promise<AutosaveResult<T>>;id:()=>string;current?:()=>boolean;validate?:(value:unknown)=>value is T;changed?:()=>void;committed?:(receipt:AutosaveReceipt<T>)=>void}){
  this.key=`velora_smart_settings_v1:${options.scope}`;
  this.state={value:options.value,baseline:options.value,revision:options.revision,digest:options.digest,status:'saved',code:null};
  try{const raw=options.storage.getItem(this.key);if(raw){const saved=JSON.parse(raw);
   const valid=(v:unknown)=>options.validate?options.validate(v):typeof v===typeof options.value;
   if(saved.scope===options.scope&&valid(saved.value)&&valid(saved.baseline)&&Number.isSafeInteger(saved.revision)&&saved.revision>=0&&typeof saved.digest==='string'&&(!equal(saved.value,saved.baseline)||saved.attempt)){
    this.state={...this.state,value:saved.value,baseline:saved.baseline,revision:saved.revision,digest:saved.digest,status:'changed'};
    if(saved.attempt&&typeof saved.attempt.id==='string'&&valid(saved.attempt.value)&&Number.isSafeInteger(saved.attempt.revision)&&typeof saved.attempt.digest==='string'){this.attempt=saved.attempt;this.state.status='unknown';}
    else if(saved.revision!==options.revision||saved.digest!==options.digest){this.state.status='conflict';this.state.code='CONFLICT';}
   }
  }}catch{this.state.status='error';this.state.code='STORAGE_UNAVAILABLE';}
 }
 private current(){return this.live&&(this.options.current?.()??true);}
 private notify(){if(this.current())this.options.changed?.();}
 private persist(){try{this.options.storage.setItem(this.key,JSON.stringify({scope:this.options.scope,value:this.state.value,baseline:this.state.baseline,revision:this.state.revision,digest:this.state.digest,attempt:this.attempt}));return true;}catch{this.state.status='error';this.state.code='STORAGE_UNAVAILABLE';return false;}}
 edit(value:T){if(!this.current())return;const blocked=this.state.status==='conflict'||this.state.status==='unknown';this.state={...this.state,value,status:blocked?this.state.status:'changed',code:blocked?this.state.code:null};this.persist();this.notify();}
 async flush(online:boolean,manual=false):Promise<void>{
  if(!this.current()||this.busy||this.state.status==='conflict'||(this.state.status==='error'&&!manual)||this.state.status==='unknown'&&!manual)return;
  if(equal(this.state.value,this.state.baseline)&&!this.attempt){this.state.status='saved';this.notify();return;}
  if(!online){this.state.status='offline';this.persist();this.notify();return;}
  this.attempt??={id:this.options.id(),value:this.state.value,revision:this.state.revision,digest:this.state.digest};
  if(!this.persist()){this.notify();return;}const submitted=this.attempt;this.busy=true;this.state.status='saving';this.notify();
  try{const result=await this.options.save(submitted);if(!this.current()){this.state.status='unknown';return;}
   if(result.ok){this.state={...this.state,baseline:result.data.value,revision:result.data.revision,digest:result.data.digest,value:equal(this.state.value,submitted.value)?result.data.value:this.state.value,status:equal(this.state.value,submitted.value)?'saved':'changed',code:null};this.attempt=null;this.persist();this.options.committed?.(result.data);}
   else{this.state.status=result.code==='CONFLICT'?'conflict':result.code==='UNAVAILABLE'?'unknown':'error';this.state.code=result.code;if(result.code!=='UNAVAILABLE')this.attempt=null;this.persist();}
  }catch{if(this.current()){this.state.status='unknown';this.state.code='UNAVAILABLE';this.persist();}}
  finally{this.busy=false;this.notify();}
 }
 reload(value:T,revision:number,digest:string){if(this.busy||!this.current())return;this.attempt=null;this.state={value,baseline:value,revision,digest,status:'saved',code:null};this.persist();this.notify();}
 dispose(){this.live=false;}
}
