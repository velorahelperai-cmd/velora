import {it,expect,vi} from 'vitest';
import {recordSessionCheckUnavailable} from './browser.mjs';
const correlation={request_id:'VEL-0123456789ABCDEF',trace_id:'1234567890abcdef1234567890abcdef',parent_span_id:'1234567890abcdef'};
it('uses validated auth correlation for the local session failure record',()=>{
 const warn=vi.fn();recordSessionCheckUnavailable({}, {warn} as never,{code:'TRANSPORT',stage:'server_auth',correlation});
 expect(warn).toHaveBeenCalledWith(expect.objectContaining({request_id:correlation.request_id,trace_id:correlation.trace_id,span_id:correlation.parent_span_id}));
});
it('never reflects invalid correlation fields or uses them as browser identity',()=>{
 const warn=vi.fn();recordSessionCheckUnavailable({}, {warn} as never,{correlation:{...correlation,password:'private payload',user_id:'admin'}});
 expect(JSON.stringify(warn.mock.calls)).not.toContain('private payload');expect(warn.mock.calls[0][0].user_id).toBeNull();expect(warn.mock.calls[0][0].request_id).not.toBe(correlation.request_id);
});
