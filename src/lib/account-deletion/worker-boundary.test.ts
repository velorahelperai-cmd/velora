import {describe,expect,it,vi} from 'vitest';
import {runPersistedInboundJob,type IntegrationPorts} from '@/lib/whatsapp/integration-worker';
import {runOperationalAnswer,type WorkerPorts} from '@/lib/answers/operational-worker/run';

// Control-flow tests complement native table probes; they do not certify provider
// cancellation or the complete SQL frame/recipient chain.
describe('deletion fence at worker admission',()=>{
 it.each(['absent','denied'])('does not dispatch when persisted inbound frame is %s',async mode=>{
  const send=vi.fn(),answer=vi.fn(),reserve=vi.fn(),context=vi.fn();
  const ports={enabled:true,frame:vi.fn(async()=>{if(mode==='denied')throw Error('ACCOUNT_DELETING');return null;}),send,answer,reserve,context,retry:vi.fn(async()=>{throw Error('ACCOUNT_DELETING');})} as unknown as IntegrationPorts;
  const result=await runPersistedInboundJob({jobId:'synthetic-job',claimToken:'synthetic-claim',companyId:'synthetic-company'},ports);
  expect(result).toMatchObject({ok:false,jobCompleted:false,sendAccepted:false});
  for(const effect of [send,answer,reserve,context])expect(effect).not.toHaveBeenCalled();
 });
 it('does not invoke an operational provider when the SQL frame rejects the fence',async()=>{
  const complete=vi.fn(),stage=vi.fn(),reserveCost=vi.fn();
  const ports={enabled:true,loadFrame:vi.fn(async()=>{throw Error('ACCOUNT_DELETING');}),complete,stage,reserveCost} as unknown as WorkerPorts;
  await expect(runOperationalAnswer('synthetic-job','synthetic-claim',ports)).rejects.toThrow('ACCOUNT_DELETING');
  for(const effect of [complete,stage,reserveCost])expect(effect).not.toHaveBeenCalled();
 });
});
