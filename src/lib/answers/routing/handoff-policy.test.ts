import {expect,it} from 'vitest';
import {classifyHandoffPolicy,DEFAULT_RISK_KEYWORDS} from './handoff-policy';
import {MultiModelAIRouter} from './router';
it.each([
 ['اريد المدير','human_request',false],['المدير المسؤول','human_request',false],['Please contact the MANAGER','human_request',false],
 ['أريد استرجاع المبلغ','sensitive',true],['Please confirm my bank transfer','sensitive',true],['I have a complaint','sensitive',false],
 ['manager: issue a refund','sensitive',true],['What are your hours?',null,false],['ما هي ساعات العمل؟',null,false],['',null,false],
] as const)('pure preview classifies existing policy: %s',(question,previewReason,verificationRequired)=>{
 expect(classifyHandoffPolicy(question)).toMatchObject({previewReason,verificationRequired});
});
it('preserves risk ordering, caller configuration and existing router semantics',()=>{
 const router=new MultiModelAIRouter();
 for(const keyword of DEFAULT_RISK_KEYWORDS){
  const policy=classifyHandoffPolicy(keyword),r=router.classify({question:keyword,locale:'en',chunks:[]});
  expect(r.taskType).toBe('risk_escalation');expect(r.verificationRequired).toBe(policy.verificationRequired);
  expect(r.reason).toContain(`Risk keyword detected: "${policy.matchedRisk}"`);
 }
 expect(classifyHandoffPolicy('manager',[])).toEqual({matchedRisk:undefined,verificationRequired:false,previewReason:null});
 expect(classifyHandoffPolicy('refund',[])).toEqual({matchedRisk:undefined,verificationRequired:true,previewReason:'sensitive'});
 expect(classifyHandoffPolicy('CUSTOM', ['Custom'])).toMatchObject({matchedRisk:'Custom',previewReason:'sensitive'});
});
it('does not invent new triggers or imply unmatched text is verified',()=>{
 expect(classifyHandoffPolicy('I want a human')).toMatchObject({previewReason:null});
 expect(classifyHandoffPolicy('أريد موظف بشري')).toMatchObject({previewReason:null});
});
