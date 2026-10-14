import {EventEmitter} from 'node:events';
import {expect,it,vi} from 'vitest';
vi.mock('server-only',()=>({}));
const mocked=vi.hoisted(()=>({request:vi.fn(),lookup:vi.fn()}));vi.mock('node:https',()=>({request:mocked.request}));vi.mock('node:dns/promises',()=>({lookup:mocked.lookup}));
import {publicImportHttp} from './public-import-http';
it('transport pins the selected IPv4 while keeping original TLS hostname and no authentication headers',async()=>{
 mocked.request.mockImplementation((url:URL,options:{lookup:unknown;servername:unknown;headers:Record<string,string>},callback:(r:unknown)=>void)=>{const req=new EventEmitter() as EventEmitter&{end:()=>void};req.end=()=>{const response=new EventEmitter() as EventEmitter&{headers:Record<string,string>;statusCode:number;destroy:()=>void};Object.assign(response,{headers:{'content-type':'text/plain'},statusCode:200,destroy:vi.fn()});callback(response);response.emit('data',Buffer.from('public facts'));response.emit('end');};return req;});
 expect(await publicImportHttp.request(new URL('https://public.example/services'),'93.184.216.34',AbortSignal.timeout(1000),100)).toMatchObject({status:200,body:'public facts'});
 const options=mocked.request.mock.calls[0][1];expect(options.servername).toBe('public.example');expect(options.rejectUnauthorized).toBe(true);expect(options.headers.Cookie).toBeUndefined();expect(options.headers.Authorization).toBeUndefined();const callback=vi.fn();options.lookup('rebound.example',{},callback);expect(callback).toHaveBeenCalledWith(null,'93.184.216.34',4);
});
it('transport stops an oversized stream before collecting further bytes',async()=>{
 let destroyed=false;mocked.request.mockImplementation((_url:URL,_options:unknown,callback:(r:unknown)=>void)=>{const req=new EventEmitter() as EventEmitter&{end:()=>void};req.end=()=>{const r=new EventEmitter() as EventEmitter&{headers:Record<string,string>;statusCode:number;destroy:()=>void};Object.assign(r,{headers:{},statusCode:200,destroy:()=>{destroyed=true;}});callback(r);r.emit('data',Buffer.from('exceeds limit'));};return req;});await expect(publicImportHttp.request(new URL('https://public.example/services'),'93.184.216.34',AbortSignal.timeout(1000),4)).rejects.toThrow('CONTENT_TOO_LARGE');expect(destroyed).toBe(true);
});
