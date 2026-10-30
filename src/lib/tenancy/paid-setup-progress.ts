import type {LaunchSummarySnapshot} from '@/components/app/paid-launch-summary';
import type {PaidBranchSetupRead,PaidSetupStepStatus} from './paid-setup-contracts';

/** Server composition of persisted readiness. It never persists or grants completion. */
export function composePaidSetupProgress(read:PaidBranchSetupRead,snapshot:LaunchSummarySnapshot|null):PaidBranchSetupRead{
 if(read.sourceStatus!=='ready'||!read.selectedChannels?.length||!read.entitlement)return read;
 const same=!!snapshot&&snapshot.setup.companyId===read.companyId&&snapshot.setup.selectedBranchId===read.selectedBranchId&&JSON.stringify(snapshot.setup.selectedChannels)===JSON.stringify(read.selectedChannels)&&JSON.stringify(snapshot.setup.entitlement)===JSON.stringify(read.entitlement);
 if(!same)return read;
 const blockers=snapshot.readiness.blockers;
 const known=blockers.every(v=>['hours_incomplete','knowledge_incomplete','language_unconfirmed','trial_incomplete'].includes(v)||read.selectedChannels!.some(ch=>v===`channel_unverified:${ch}`));
 if(!known||snapshot.readiness.status==='unknown')return read;
 // Knowledge step owns reply-language confirmation in the UI; launch still requires the native language_unconfirmed blocker to clear.
 const completed={
  hours:snapshot.summary.hours.status==='verified',
  knowledge:snapshot.summary.knowledge.status==='verified'&&!blockers.includes('language_unconfirmed'),
  assistant_test:!blockers.includes('trial_incomplete'),
 };
 const steps=read.steps.map(s=>({...s,dependencyIds:[...s.dependencyIds],reasonCodes:[...s.reasonCodes]}));
 for(const item of steps){
  if(item.id==='invitations'){item.status='pending';item.reasonCodes=['setup_incomplete'];continue;}
  if(!(item.id in completed))continue;
  const verified=completed[item.id as keyof typeof completed];
  const dependencies=item.dependencyIds.every(id=>steps.some(v=>v.id===id&&v.status==='verified'));
  item.status=(verified?'verified':dependencies?'pending':'blocked') as PaidSetupStepStatus;
  item.reasonCodes=verified?[]:dependencies?(item.id==='knowledge'&&blockers.includes('language_unconfirmed')?['language_unconfirmed']:['setup_incomplete']):['awaiting_required_steps'];
 }
 const launchStep=steps.find(s=>s.id==='launch');
 const allRequired=steps.filter(s=>s.required&&s.id!=='launch').every(s=>s.status==='verified');
 const canRequest=allRequired&&snapshot.readiness.status==='ready'&&snapshot.setup.launch.canRequest;
 const confirmed=snapshot.activation.status==='launched'&&snapshot.setup.launch.confirmed;
 if(launchStep){launchStep.status=confirmed?'verified':canRequest?'pending':'blocked';launchStep.reasonCodes=confirmed||canRequest?[]:[...blockers];}
 return {...read,steps,progress:{denominator:steps.length,verified:steps.filter(s=>s.status==='verified').length,skippedOptional:steps.filter(s=>s.status==='skipped_optional').length},launch:{confirmationRequired:true,confirmed,canRequest,blockedReasons:canRequest||confirmed?[]:[...blockers]}};
}
