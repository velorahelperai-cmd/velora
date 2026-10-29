import {expect,it} from 'vitest';
import {composePaidSetupProgress} from './paid-setup-progress';
import {projectTrustedBoundSelection,mergePaidBranchChannelProof} from './paid-setup-contracts';
import type {LaunchSummarySnapshot} from '@/components/app/paid-launch-summary';
const facts={companyId:'company',branchId:'branch',branchLabel:'Main',orderGroupId:'order',slotIndex:0,persona:'level_2' as const,package:'basic' as const,term:'monthly' as const,maxChannels:1,employeesExcludingOwner:2,clockState:'waiting_readiness',asOf:'now'};
const read=mergePaidBranchChannelProof(projectTrustedBoundSelection(facts,{channels:['whatsapp']}),[{...facts,channel:'whatsapp',verified:true,generation:1,revoked:false,stale:false}]);
function snap(blockers:string[]):LaunchSummarySnapshot{return {setup:{...read,launch:{confirmationRequired:true,confirmed:false,canRequest:!blockers.length,blockedReasons:blockers}},scope:{expectedAccountId:'actor',companyId:'company',branchId:'branch'},version:1,branchLabel:'Main',readiness:{status:blockers.length?'blocked':'ready',revision:'a'.repeat(32),blockers},summary:{hours:{detail:'',status:blockers.includes('hours_incomplete')?'pending':'verified'},knowledge:{detail:'',status:blockers.includes('knowledge_incomplete')?'pending':'verified'},persona:{detail:'',status:'verified'},channels:[],team:{detail:'deferred',status:'skipped_optional'}},operationId:'op',activation:{status:'not_started',receiptId:null,operationId:null}};}
const status=(value:ReturnType<typeof composePaidSetupProgress>,id:string)=>value.steps.find(s=>s.id===id)?.status;
it('opens hours after stable channel proof without declaring it complete',()=>{const r=composePaidSetupProgress(read,snap(['hours_incomplete','knowledge_incomplete','language_unconfirmed','trial_incomplete']));expect(status(r,'hours')).toBe('pending');expect(status(r,'knowledge')).toBe('blocked');expect(r.launch.canRequest).toBe(false);});
it('opens each next step from native completion and does not require deferred team',()=>{const r=composePaidSetupProgress(read,snap(['language_unconfirmed','trial_incomplete']));expect(status(r,'hours')).toBe('verified');expect(status(r,'knowledge')).toBe('verified');expect(status(r,'language')).toBe('pending');expect(status(r,'assistant_test')).toBe('blocked');expect(status(r,'invitations')).toBe('skipped_optional');const ready=composePaidSetupProgress(read,snap([]));expect(ready.launch.canRequest).toBe(true);expect(ready.launch.confirmed).toBe(false);expect(status(ready,'launch')).toBe('pending');});
it('does not invent completion from missing foreign or unknown evidence',()=>{expect(composePaidSetupProgress(read,null)).toBe(read);const foreign=snap([]);foreign.setup.companyId='foreign';expect(composePaidSetupProgress(read,foreign)).toBe(read);expect(composePaidSetupProgress(read,snap(['future_blocker']))).toBe(read);});
it('invalidates stale trial completion when native readiness reports it incomplete',()=>{const r=composePaidSetupProgress(read,snap(['trial_incomplete']));expect(status(r,'assistant_test')).toBe('pending');expect(r.launch.canRequest).toBe(false);});
it('allows hours, knowledge, language, and assistant_test to progress while WhatsApp remains unverified and keeps launch blocked',()=>{
 const unverifiedRead=projectTrustedBoundSelection(facts,{channels:['whatsapp']});
 const s=snap(['channel_unverified:whatsapp','trial_incomplete']);
 s.setup={...unverifiedRead,launch:{confirmationRequired:true,confirmed:false,canRequest:false,blockedReasons:['channel_unverified:whatsapp','trial_incomplete']}};
 const r=composePaidSetupProgress(unverifiedRead,s);
 expect(status(r,'connect_whatsapp')).toBe('pending');
 expect(status(r,'hours')).toBe('verified');
 expect(status(r,'knowledge')).toBe('verified');
 expect(status(r,'language')).toBe('verified');
 expect(status(r,'assistant_test')).toBe('pending');
 expect(status(r,'launch')).toBe('blocked');
 expect(r.launch.canRequest).toBe(false);
 expect(r.progress.verified).toBe(3);
});
