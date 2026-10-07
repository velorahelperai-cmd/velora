export type SubscriptionAccessContext = {
 needsProfileName:boolean;isPlatformAdmin:boolean;needsCompanyContext:boolean;
 company:{status:string}|null;membership:{role:"owner"|"staff"}|null;
};
type Access = {ok:true;context:SubscriptionAccessContext}|{ok:false;code:string};
export type SubscriptionDestination = {href:string;kind:"manage"|"workspace"|"platform"|"chooseCompany"|"login"|"verify"|"profile"|"setup"|"access";note:"staff"|"platform"|"select_company"|null;adminHref?:string};
export function subscriptionSettingsAccess(ctx:SubscriptionAccessContext):"owner"|"staff"|"select_company"|"no_company" {
 if(ctx.needsCompanyContext)return "select_company";
 if(!ctx.company||!ctx.membership)return "no_company";
 return ctx.membership.role;
}
/** Navigation only; existing route/action authorization remains authoritative. */
export function subscriptionDestination(access:Access):SubscriptionDestination {
 if(!access.ok){
  if(access.code==="UNVERIFIED")return {href:"/verify-email",kind:"verify",note:null};
  if(access.code==="FORBIDDEN"||access.code==="UNAVAILABLE")return {href:"/access?code="+access.code,kind:"access",note:null};
  return {href:"/login?next=%2Fapp%2Fsettings%3Ftab%3Dplan",kind:"login",note:null};
 }
 const ctx=access.context,adminHref=ctx.isPlatformAdmin?"/admin":undefined;
 if(ctx.needsProfileName)return {href:"/complete-profile",kind:"profile",note:null};
 if(ctx.needsCompanyContext)return {href:"/app/settings?tab=plan",kind:"chooseCompany",note:"select_company",adminHref};
 if(!ctx.company||!ctx.membership)return ctx.isPlatformAdmin?{href:"/admin",kind:"platform",note:"platform"}:{href:"/setup",kind:"setup",note:null};
 if(ctx.membership.role==="staff")return {href:"/app/conversations",kind:"workspace",note:"staff",adminHref};
 return {href:"/app/settings?tab=plan",kind:"manage",note:null,adminHref};
}
