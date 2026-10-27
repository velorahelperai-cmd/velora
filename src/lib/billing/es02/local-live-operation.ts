import 'server-only';
import {readFile,writeFile,rename,unlink} from 'node:fs/promises';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {es02Uuid} from './contracts';
import {resolveEs02Offer,type Es02OfferSelection} from './commercial-offer';
import {validatePreparation,type Preparation} from '@/lib/tenancy/prepayment-preparation';
export type LocalLiveOperation={version:1;accountId:string;grantId:string;clientOpId:string;selection:Es02OfferSelection;preparation:Preparation;orderId?:string};
type Binding={accountId:string;grantId:string};
function path(binding:Binding){if(!es02Uuid(binding.accountId)||!es02Uuid(binding.grantId)||!process.env.LOCALAPPDATA)throw Error('LOCAL_OPERATION_BINDING_REQUIRED');return join(process.env.LOCALAPPDATA,'Velora','LocalCustomer',`operation-${binding.grantId}.json`);}
function parse(value:unknown,binding:Binding):LocalLiveOperation{
 const v=value as LocalLiveOperation|null;
 if(!v||v.version!==1||v.accountId!==binding.accountId||v.grantId!==binding.grantId||!es02Uuid(v.clientOpId)||!v.preparation||validatePreparation(v.preparation).length||v.preparation.branches.length!==1||!resolveEs02Offer(v.selection).ok||(v.orderId!==undefined&&!es02Uuid(v.orderId)))throw Error('LOCAL_OPERATION_RECOVERY_REQUIRED');
 return v;
}
/** This local, user-only recovery hint is never payment or entitlement authority. */
export async function readLocalLiveOperation(binding:Binding):Promise<LocalLiveOperation|null>{
 try{return parse(JSON.parse(await readFile(path(binding),'utf8')),binding);}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return null;throw Error('LOCAL_OPERATION_RECOVERY_REQUIRED');}
}
export async function retainLocalLiveOperation(binding:Binding,input:Pick<LocalLiveOperation,'clientOpId'|'selection'|'preparation'>):Promise<LocalLiveOperation>{
 // Never serialize the configuration object: it also contains server secrets.
 const record=parse({version:1,accountId:binding.accountId,grantId:binding.grantId,clientOpId:input.clientOpId,selection:input.selection,preparation:input.preparation},binding);
 try{await writeFile(path(binding),JSON.stringify(record),{flag:'wx',mode:0o600});return record;}
 catch(error){if((error as NodeJS.ErrnoException).code!=='EEXIST')throw Error('LOCAL_OPERATION_RECOVERY_REQUIRED');}
 const prior=await readLocalLiveOperation(binding);
 if(!prior||!isDeepStrictEqual(prior.selection,record.selection)||!isDeepStrictEqual(prior.preparation,record.preparation))throw Error('LOCAL_OPERATION_RECOVERY_REQUIRED');
 return prior;
}
export async function bindLocalLiveOrder(binding:Binding,orderId:string):Promise<void>{
 const record=await readLocalLiveOperation(binding);if(!record||!es02Uuid(orderId)||(record.orderId&&record.orderId!==orderId))throw Error('LOCAL_OPERATION_RECOVERY_REQUIRED');
 const destination=path(binding),temporary=destination+'.'+randomUUID()+'.tmp';
 try{await writeFile(temporary,JSON.stringify({...record,orderId}),{flag:'wx',mode:0o600});await rename(temporary,destination);}finally{await unlink(temporary).catch(()=>{});}
}
