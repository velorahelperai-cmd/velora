import {expect,it} from "vitest";
import {publishSessionContext, publishSessionLogout, subscribeSessionContext, SESSION_CONTEXT_KEY} from "./session-context";
function peers(){const values=new Map<string,string>();const listeners=new Map<unknown,(e:StorageEvent)=>void>();const targets:Window[]=[];const make=()=>{const storage={getItem:(key:string)=>values.get(key)??null,setItem:(key:string,value:string)=>{values.set(key,value);for(const target of targets)if(target!==port)listeners.get(target)?.({key,newValue:value,storageArea:target.localStorage} as StorageEvent);}};const port={localStorage:storage,addEventListener:(_name:string,fn:(e:StorageEvent)=>void)=>listeners.set(port,fn),removeEventListener:()=>listeners.delete(port)} as unknown as Window;targets.push(port);return port;};return {a:make(),b:make(),values,listeners};}
it("a peer receives only invalidation IDs and repeated verified context does not loop",()=>{
 const p=peers(),received:unknown[]=[];subscribeSessionContext(signal=>received.push(signal),p.b);
 const context={userId:"user-a",companyId:"company-a",accessToken:"synthetic-must-never-be-written"};
 publishSessionContext(context,p.a);publishSessionContext({userId:"user-a",companyId:"company-a"},p.b);
 expect(received).toEqual([{type:"context",userId:"user-a",companyId:"company-a"}]);
 expect(Object.keys(JSON.parse(p.values.get(SESSION_CONTEXT_KEY)!)).sort()).toEqual(["companyId","nonce","type","userId","version"]);
 publishSessionLogout("user-a",p.a);expect(received.at(-1)).toEqual({type:"logout",userId:"user-a"});
});
it("rejects malformed peer messages and removes listeners on cleanup",()=>{
 const p=peers(),received:unknown[]=[];const stop=subscribeSessionContext(signal=>received.push(signal),p.b);
 for(const raw of ["broken",JSON.stringify({version:1,type:"context",userId:"person@example.invalid",companyId:null,nonce:"synthetic"}),JSON.stringify({version:1,type:"context",userId:"user-a",companyId:null,nonce:"synthetic",token:"not-allowed"})])p.a.localStorage.setItem(SESSION_CONTEXT_KEY,raw);
 expect(received).toEqual([]);stop();publishSessionLogout("user-a",p.a);expect(received).toEqual([]);
});
it("storage denial does not interrupt auth or cleanup",()=>{
 const port={localStorage:{getItem(){throw Error("denied");},setItem(){throw Error("denied");}}} as unknown as Window;
 expect(()=>publishSessionContext({userId:"user-a",companyId:null},port)).not.toThrow();expect(()=>publishSessionLogout("user-a",port)).not.toThrow();
});
