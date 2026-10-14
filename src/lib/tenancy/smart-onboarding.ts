import type {CompanyRecord,CompanyReviewRequest} from './types';
import {selectedIncludedChannels,type ChannelContract} from '@/lib/channels/contract';

export type SetupStatus='not_started'|'in_progress'|'needs_attention'|'ready'|'active'|'failed';
export type SetupCardId='profile'|'branches'|'knowledge'|'language'|'hours'|'trial'|'channels'|'subscription'|'review';
export type SmartBranchSetup={companyId:string;revision:number;mode:'single'|'multiple'|null;branches:{id:string;name:string;primary:boolean;status:'setup'|'active'|'suspended'}[]};
export type SmartSetupCard={id:SetupCardId;status:SetupStatus;required:boolean;missing:string|null;step:number|null;href?:string};
export const setupUuid=(v:unknown):v is string=>typeof v==='string'&&/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(v);
const record=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);

export function parseSmartBranchSetup(value:unknown,companyId:string):SmartBranchSetup|null{
 if(!record(value)||value.companyId!==companyId||!Number.isSafeInteger(value.revision)||Number(value.revision)<0
  ||![null,'single','multiple'].includes(value.mode as null|'single'|'multiple')||!Array.isArray(value.branches))return null;
 const branches=value.branches;
 if(branches.some(b=>!record(b)||!setupUuid(b.id)||typeof b.name!=='string'||!b.name.trim()||b.name.length>120
  ||typeof b.primary!=='boolean'||!['setup','active','suspended'].includes(String(b.status)))
  ||new Set(branches.map(b=>b.id)).size!==branches.length||branches.filter(b=>b.primary).length!==1)return null;
 return {companyId,revision:Number(value.revision),mode:value.mode as SmartBranchSetup['mode'],branches:branches.map(b=>({id:b.id,name:b.name,primary:b.primary,status:b.status}))};
}

/** Read-only presentation. Skips, navigation and local trial flags are never evidence. */
export function buildSmartOnboarding(input:{
 company:CompanyRecord|null;branchSetup:SmartBranchSetup|null;knowledge:SetupStatus;
 contract:ChannelContract|null;review:CompanyReviewRequest|null;reviewLoadFailed:boolean;
 operationalChannels:readonly string[];
 reviewPolicyReady?:boolean;
}){
 const company=input.company,allowed=!!company&&company.status!=='suspended';
 const branch=input.branchSetup?.companyId===company?.id?input.branchSetup:null;
 const contract=input.contract?.companyId===company?.id?input.contract:null;
 const review=input.review?.company_id===company?.id?input.review:null;
 const selected=contract?selectedIncludedChannels(contract):[];
 const subscription=contract?.subscription.state==='active';
 const channelReady=selected.filter(ch=>allowed&&subscription&&input.operationalChannels.includes(ch));
 const profile=allowed&&!!company?.display_name.trim()&&!!company.business_type.trim()&&!!company.country.trim();
 const pendingBranches=branch?.branches.some(b=>b.status==='setup')??false;
 const branches=allowed&&!!branch?.mode&&branch.branches.some(b=>b.primary&&b.status==='active')&&!pendingBranches;
 const knowledge=allowed&&['ready','active'].includes(input.knowledge);
 const language=allowed&&!!company?.reply_language;
 const approved=allowed&&input.reviewPolicyReady!==false&&!input.reviewLoadFailed&&review?.status==='approved'&&review.proof_current===true;
 const requirements=[profile,branches,knowledge,language,approved,selected.length>0,...selected.map(ch=>channelReady.includes(ch)),...(selected.length?[allowed&&subscription]:[])];
 const channelStatus:SetupStatus=!contract?'failed':contract.plan_entitlements.status!=='approved'?'needs_attention':!selected.length?'not_started':channelReady.length===selected.length?'active':'needs_attention';
 const cards:SmartSetupCard[]=[
  {id:'profile',status:profile?'ready':'needs_attention',required:true,missing:profile?null:'profile',step:0},
  {id:'branches',status:branches?'ready':!branch?'failed':pendingBranches?'needs_attention':'in_progress',required:true,missing:branches?null:pendingBranches?'branch_pending':'branches',step:null},
  {id:'knowledge',status:input.knowledge,required:true,missing:knowledge?null:'knowledge',step:3},
  {id:'language',status:language?'ready':'not_started',required:true,missing:language?null:'language',step:4},
  {id:'hours',status:allowed&&company?.hours.trim()?'ready':'not_started',required:false,missing:company?.hours.trim()?null:'hours',step:2},
  {id:'trial',status:'not_started',required:false,missing:'trial',step:6},
  {id:'channels',status:channelStatus,required:true,missing:channelStatus==='active'?null:!contract?'unavailable':contract.plan_entitlements.status!=='approved'?'channel_policy':selected.length?'channel_verification':'channel_selection',step:5},
  {id:'subscription',status:subscription&&allowed?'active':!contract?'failed':'not_started',required:selected.length>0,missing:subscription?null:'subscription',step:1},
  {id:'review',status:input.reviewLoadFailed?'failed':input.reviewPolicyReady===false?'needs_attention':approved?'ready':review?.status==='pending_review'?'in_progress':review?.status==='changes_requested'||review?.status==='approved'?'needs_attention':'not_started',required:true,missing:approved?null:input.reviewPolicyReady===false?'review_configuration':'review',step:7},
 ];
 if(!allowed)for(const card of cards){card.status=company?.status==='suspended'?'needs_attention':'not_started';}
 const completedRequired=allowed?requirements.filter(Boolean).length:0;
 return {cards,completedRequired,totalRequired:requirements.length,percent:Math.round(completedRequired/requirements.length*100),selectedChannels:selected};
}
