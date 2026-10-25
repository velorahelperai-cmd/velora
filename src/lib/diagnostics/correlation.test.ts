import {describe,it,expect} from 'vitest';
import {readAuthCorrelation,authCorrelationHeaders,readAuthCorrelationHeaders} from './correlation.mjs';
const packet={request_id:'VEL-0123456789ABCDEF',trace_id:'1234567890abcdef1234567890abcdef',parent_span_id:'1234567890abcdef'};
describe('untrusted auth correlation metadata',()=>{
 it('copies only a complete bounded metadata packet',()=>{const result=readAuthCorrelation(packet);expect(result).toEqual(packet);expect(result).not.toBe(packet);});
 it.each([null,[],{},'abc',{...packet,request_id:'customer@example.test'},{...packet,trace_id:'0'.repeat(32)},{...packet,parent_span_id:'0'.repeat(16)},{...packet,trace_id:'a'.repeat(100000)},{...packet,request_id:packet.request_id+'\n'},{...packet,password:'never-log-this'},{...packet,user_id:'admin'}])('rejects malformed or additional fields (%#)',value=>{expect(readAuthCorrelation(value)).toBeNull();});
 it('does not evaluate unexpected payload fields or throw on hostile accessors',()=>{const bad=Object.defineProperty({},'request_id',{get(){throw Error('sensitive-content');},enumerable:true});expect(()=>readAuthCorrelation(bad)).not.toThrow();expect(readAuthCorrelation(bad)).toBeNull();});
});

it('carries validated metadata in fixed headers and ignores malformed values',()=>{
 const headers=authCorrelationHeaders(packet);expect(Object.keys(headers)).toHaveLength(3);expect(readAuthCorrelationHeaders(new Headers(headers))).toEqual(packet);expect(authCorrelationHeaders({...packet,password:'private'})).toEqual({});expect(readAuthCorrelationHeaders(new Headers({'x-velora-request-id':'private@example.test'}))).toBeNull();
});
