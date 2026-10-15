import {parseSmartStartStorage,type SmartStartAttempt} from './smart-business-start-storage';
type StoragePort=Pick<Storage,'getItem'|'setItem'>;
export const businessRecoveryKey=(userId:string)=>`velora_business_creation_recovery_v2:${userId}`;
type Receipt={userId:string;state:'confirmed'|'rejected';attemptId:string;companyId?:string};
export function readBusinessCreationRecovery(storage:StoragePort,userId:string):SmartStartAttempt|null{
 const currentRaw=storage.getItem(businessRecoveryKey(userId));
 let receipt:Receipt|undefined;
 if(currentRaw){const item=JSON.parse(currentRaw);if(item.userId!==userId)throw Error('INVALID_RECOVERY');
  if(item.state==='pending'){const saved=parseSmartStartStorage(item,userId);if(!saved?.attempt)throw Error('INVALID_RECOVERY');return saved.attempt;}
  if(!['confirmed','rejected'].includes(item.state)||typeof item.attemptId!=='string')throw Error('INVALID_RECOVERY');receipt=item;
 }
 // A legacy immutable submitted request must still be recoverable. Unsubmitted fields are never restored.
 const legacyRaw=storage.getItem(`velora_smart_first_business:${userId}`);if(!legacyRaw)return null;
 const legacy=JSON.parse(legacyRaw);if(!legacy.attempt)return null;
 if(receipt?.attemptId===legacy.attempt.id)return null;
 const saved=parseSmartStartStorage(legacy,userId);if(!saved?.attempt)throw Error('INVALID_RECOVERY');return saved.attempt;
}
export function persistBusinessCreationAttempt(storage:StoragePort,userId:string,attempt:SmartStartAttempt):void{
 storage.setItem(businessRecoveryKey(userId),JSON.stringify({userId,state:'pending',fields:attempt.fields,attempt}));
}
export function settleBusinessCreationAttempt(storage:StoragePort,userId:string,attemptId:string,state:Receipt['state'],companyId?:string):void{
 storage.setItem(businessRecoveryKey(userId),JSON.stringify({userId,state,attemptId,...(companyId?{companyId}:{})}));
}
