import {expect,it,vi} from 'vitest';
import {handleInstagramOAuthCallback} from './oauth-route';
const aid='abcdefab-0000-4000-8000-000000000003',state='a'.repeat(64);
const url=(q:string)=>new Request('https://www.velorahelper.com/api/instagram/oauth/callback?'+q);
const deps=()=>({readAttempt:vi.fn(async()=>aid),complete:vi.fn(async()=>({ok:true as const,linkId:aid})),clearAttempt:vi.fn(async()=>{}),appOrigin:'https://www.velorahelper.com'});
it('valid callback strips code/state from redirect and disables cache/referrers',async()=>{const d=deps(),r=await handleInstagramOAuthCallback(url('code=synthetic-code&state='+state),d);expect(d.complete).toHaveBeenCalledWith({attemptId:aid,state,code:'synthetic-code'});expect(d.clearAttempt).toHaveBeenCalledTimes(1);expect(r.headers.get('location')).toBe('https://www.velorahelper.com/app/instagram?connection=connected');expect(r.headers.get('referrer-policy')).toBe('no-referrer');expect(r.headers.get('cache-control')).toContain('no-store');});
it.each(['code=x&state='+state+'&state='+state,'code=x&state=wrong','state='+state,'code=x&state='+state+'&code=y'])('malformed/duplicate parameters do not invoke completion',async query=>{const d=deps();await handleInstagramOAuthCallback(url(query),d);expect(d.complete).not.toHaveBeenCalled();expect(d.clearAttempt).not.toHaveBeenCalled();});
it('missing opaque cookie cannot borrow another attempt from query',async()=>{const d=deps();d.readAttempt.mockResolvedValueOnce('');await handleInstagramOAuthCallback(url('code=x&state='+state+'&attemptId='+aid),d);expect(d.complete).not.toHaveBeenCalled();});
it('ambiguous result preserves cookie and redirects only safe status',async()=>{const d=deps();d.complete.mockResolvedValueOnce({ok:false,code:'RECONCILIATION_REQUIRED'} as never);const r=await handleInstagramOAuthCallback(url('code=secret&state='+state),d);expect(r.headers.get('location')).toContain('connection=needs_review');expect(r.headers.get('location')).not.toContain('secret');expect(d.clearAttempt).not.toHaveBeenCalled();});
it('failed authorization carries only a validated public support reference and phase',async()=>{
 const d=deps();d.complete.mockResolvedValueOnce({ok:false,code:'CONSUMED',diagnostic:{reference:'VEL-0123456789ABCDEF',operation:'instagram_connect',stage:'code_exchange',code:'PROVIDER_REJECTED'}} as never);
 const r=await handleInstagramOAuthCallback(url('code=private-code&state='+state),d),redirect=new URL(r.headers.get('location')!);
 expect(redirect.searchParams.get('support')).toBe('VEL-0123456789ABCDEF');expect(redirect.searchParams.get('phase')).toBe('code_exchange');expect(redirect.href).not.toContain('private-code');
});
it('untrusted diagnostic data cannot escape in the callback redirect',async()=>{
 const d=deps();d.complete.mockResolvedValueOnce({ok:false,code:'CONSUMED',diagnostic:{reference:'private-token',operation:'instagram_connect',stage:'raw secret',code:'PROVIDER_REJECTED'}} as never);
 const r=await handleInstagramOAuthCallback(url('code=private-code&state='+state),d);
 expect(new URL(r.headers.get('location')!).searchParams.has('support')).toBe(false);expect(r.headers.get('location')).not.toMatch(/private-token|raw secret/);
});
