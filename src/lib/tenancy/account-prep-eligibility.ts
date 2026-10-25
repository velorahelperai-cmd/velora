/** Existing C09 account/new policy, shared by entry pages and draft actions. No privilege is derived from a draft. */
type PrepActor={isPlatformAdmin:boolean;ownedBusinessCount?:number;membership?:{role:string}|null;workspaceChoices?:ReadonlyArray<{role:string}>;hasBusinessMemberships?:boolean};
export function canUseAccountPrepDraft(context:PrepActor):boolean{
 const owns=(context.ownedBusinessCount??0)>0||context.membership?.role==='owner'||Boolean(context.workspaceChoices?.some(choice=>choice.role==='owner'));
 return owns||(!context.isPlatformAdmin&&context.membership?.role!=='staff'&&context.hasBusinessMemberships!==true);
}
