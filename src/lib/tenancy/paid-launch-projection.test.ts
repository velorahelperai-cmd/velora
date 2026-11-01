import {expect,it} from 'vitest';
import {normalizePaidLaunchSnapshot} from './paid-launch-projection';
import {projectTrustedBoundSelection,mergePaidBranchChannelProof} from './paid-setup-contracts';
const scope={expectedAccountId:'11111111-1111-4111-8111-111111111111',companyId:'22222222-2222-4222-8222-222222222222',branchId:'33333333-3333-4333-8333-333333333333'};
const read=mergePaidBranchChannelProof(projectTrustedBoundSelection({...scope,branchLabel:'Main',orderGroupId:scope.companyId,slotIndex:0,persona:'level_2',package:'basic',term:'monthly',maxChannels:1,employeesExcludingOwner:2,clockState:'waiting_readiness',asOf:'2026-10-26T00:00:00Z'},{channels:['whatsapp']}),[{...scope,channel:'whatsapp',verified:true,generation:1,revoked:false,stale:false}]);
const item={detail:'native evidence',status:'verified'};
const fixture=()=>({scope,version:1,branchLabel:'Main',setup:{companyId:scope.companyId,selectedBranchId:scope.branchId,sourceStatus:null,selectedChannels:null,entitlement:null,launch:{confirmationRequired:true,confirmed:false,canRequest:true,blockedReasons:[] as string[]}},readiness:{status:'ready',revision:'a'.repeat(32),blockers:[] as string[]},summary:{channels:[{channel:'whatsapp',...item}],hours:item,knowledge:item,persona:item,languages:item,team:{detail:'deferred by policy',status:'deferred'}},operationId:scope.branchId,activation:{status:'not_started',receiptId:null,operationId:null}});
it('hydrates only missing presentation fields from the verified paid branch and keeps optional team neutral',()=>{
 const result=normalizePaidLaunchSnapshot(fixture(),scope,read);
 expect(result?.setup.entitlement).toEqual(read.entitlement);expect(result?.setup.selectedChannels).toEqual(['whatsapp']);expect(result?.summary.team.status).toBe('optional');expect(result?.summary.team.detail).not.toContain('deferred by policy');
});
it.each(['scope','company','channel','readiness','activation','revision','unproven'])('rejects inconsistent %s evidence',kind=>{
 const raw=fixture();let authority=read;
 if(kind==='scope')raw.scope={...scope,branchId:scope.companyId};
 if(kind==='company')raw.setup.companyId=scope.branchId;
 if(kind==='channel')raw.summary.channels[0]!.channel='instagram';
 if(kind==='readiness')raw.readiness.blockers=['hours_incomplete'];
 if(kind==='activation')raw.activation.status='launched';
 if(kind==='revision')raw.readiness.revision='';
 if(kind==='unproven')authority={...read,steps:read.steps.map(s=>s.id==='connect_whatsapp'?{...s,status:'pending'}:s)};
 expect(normalizePaidLaunchSnapshot(raw,scope,authority)).toBeNull();
});
it('preserves blocked native readiness rather than marking it ready',()=>{
 const raw=fixture();raw.readiness={status:'blocked',revision:'a'.repeat(32),blockers:['trial_incomplete']};raw.setup.launch.canRequest=false;raw.setup.launch.blockedReasons=['trial_incomplete'];
 expect(normalizePaidLaunchSnapshot(raw,scope,read)?.readiness.status).toBe('blocked');
});
export {scope,read,fixture};

it('does not infer confirmed languages from missing language data',()=>{
 const raw=fixture();const {languages:_,...summary}=raw.summary;void _;
 expect(normalizePaidLaunchSnapshot({...raw,summary},scope,read,null)).toBeNull();
 expect(normalizePaidLaunchSnapshot({...raw,summary},scope,read,{confirmation:'confirmed',replyLanguage:'en'})?.summary.languages).toEqual({status:'verified',detail:'الإنجليزية'});
});
it('shows unknown language evidence honestly on a blocked branch',()=>{
 const raw=fixture();const {languages:_,...summary}=raw.summary;void _;
 raw.readiness={status:'blocked',revision:'a'.repeat(32),blockers:['trial_incomplete']};raw.setup.launch.canRequest=false;raw.setup.launch.blockedReasons=['trial_incomplete'];
 expect(normalizePaidLaunchSnapshot({...raw,summary},scope,read,null)?.summary.languages?.status).toBe('unavailable');
});

it('does not turn optional team policy into a claimed owner decision',()=>{
 const raw=fixture();raw.summary.team.detail='دعوة الموظفين مؤجلة بقرار المالك';
 const result=normalizePaidLaunchSnapshot(raw,scope,read);
 expect(result?.summary.team).toEqual({status:'optional',detail:'دعوة الفريق اختيارية ولا تمنع الإطلاق.'});
 expect(result?.readiness).toEqual(raw.readiness);expect(result?.setup.launch).toEqual(raw.setup.launch);
});
