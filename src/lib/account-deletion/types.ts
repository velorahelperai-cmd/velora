export type DeletionCategory = 'delete' | 'shared' | 'protected' | 'blocker';
export type DeletionItem = { identity:string; relation:string; key:Record<string,string>; revision:string; category:DeletionCategory; reason:string; blocks?:boolean };
export type DeletionReceipt = {
 id:string; target:string; actor:string; createdAt:string; expiresAt:string; fingerprint:string; policyVersion:number;
 items:DeletionItem[]; isTest:boolean; fenced:boolean; states:Record<string,string>; error:string|null; completedAt:string|null; leaseUntil:string|null;
};
export type DeletionResponse = {ok:true; data:DeletionReceipt|null; code?:string; diff?:{identity:string;before:DeletionItem|null;after:DeletionItem|null}[]} | {ok:false;code:string};
