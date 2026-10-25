import {afterEach,it,expect,vi} from 'vitest';
vi.mock('server-only',()=>({}));
import {withAuthDiagnostic} from './server-flow';
import {createStructuredLogger,logEvent} from '../logging/logger.mjs';
import {beginDiagnostic} from './flow';
afterEach(()=>vi.restoreAllMocks());
it('links nested broker logs and parallel asynchronous server work without crossing requests',async()=>{
 vi.spyOn(console,'info').mockImplementation(()=>{});
 const rows:string[]=[];const logger=createStructuredLogger({write:(s:string)=>rows.push(s)});
 const a=beginDiagnostic('auth_login'),b=beginDiagnostic('auth_signup');
 const run=(root:typeof a)=>withAuthDiagnostic('auth_login',root.correlation,async trace=>{
  await Promise.resolve();logEvent('info','auth.test.accepted',{},logger);trace.finish('OK');return trace;
 });
 const [left,right]=await Promise.all([run(a),run(b)]);
 const logs=rows.map(s=>JSON.parse(s));expect(logs).toHaveLength(2);
 for(const [root,child] of [[a,left],[b,right]]){const row=logs.find(r=>r.request_id===root.reference)!;expect(row.trace_id).toBe(root.correlation.trace_id);expect(row.span_id).toBe(child.logContext.span_id);expect(child.logContext.span_id).not.toBe(root.logContext.span_id);}
 expect(a.reference).not.toBe(b.reference);
});
it('records an unknown outcome then rethrows unchanged without logging the thrown payload',async()=>{
 const info=vi.spyOn(console,'info').mockImplementation(()=>{});const failure=Error('private payload must not appear');
 await expect(withAuthDiagnostic('auth_verification',null,async()=>{throw failure;})).rejects.toBe(failure);
 const text=info.mock.calls.flat().join('');expect(text).toContain('OUTCOME_UNKNOWN');expect(text).not.toContain(failure.message);
});
