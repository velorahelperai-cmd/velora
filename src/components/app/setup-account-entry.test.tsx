// @vitest-environment jsdom
import React,{act} from 'react';
import {createRoot,type Root} from 'react-dom/client';
import {beforeEach,afterEach,expect,it,vi} from 'vitest';
const m=vi.hoisted(()=>({session:{} as Record<string,unknown>,replace:vi.fn(),current:vi.fn()}));
vi.mock('next/navigation',()=>({useRouter:()=>({replace:m.replace})}));
vi.mock('./account-chrome',()=>({useAccountSession:()=>m.session}));
vi.mock('./setup-loading',()=>({SetupLoading:()=> <nav>Public setup</nav>}));
vi.mock('./access-gate',()=>({AccessGate:({code}:{code:string})=><p>{code}</p>}));
vi.mock('./setup-wizard',()=>({PaidSetupWizard:({userId,companyId}:{userId:string;companyId:string})=><div>Paid {userId} {companyId}</div>}));
vi.mock('./prepayment-preparation',()=>({PrepaymentPreparation:({userId,preferredNext}:{userId:string;preferredNext:string})=><div>Prepare {userId} {preferredNext}</div>}));
import {SetupAccountEntry} from './setup-account-entry';
let root:Root,host:HTMLDivElement;
const next='/app/settings?tab=plan';
const render=()=>act(async()=>root.render(<SetupAccountEntry returnTo={`/setup?next=${encodeURIComponent(next)}`} preferredNext={next}/>));
beforeEach(()=>{
 vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);vi.clearAllMocks();m.current.mockReturnValue(true);
 m.session={status:'ready',boundaryFingerprint:'boundary',isCurrentUser:m.current,identity:{userId:'actor',companyId:null,setupEntry:{kind:'prepare',userId:'actor'}}};
 host=document.createElement('div');document.body.append(host);root=createRoot(host);
});
afterEach(async()=>{await act(async()=>root.unmount());host.remove();vi.unstubAllGlobals();});
it.each(['loading','expired','locked','error'])('never mounts private setup while %s',async status=>{
 m.session.status=status;await render();expect(host.textContent).toBe('Public setup');expect(m.replace).not.toHaveBeenCalled();
});
it('preserves the safe setup return for a confirmed guest',async()=>{
 m.session.status='guest';await render();expect(host.textContent).toBe('Public setup');expect(m.replace).toHaveBeenCalledWith(expect.stringContaining('/login?next='));
});
it('does not admit retained identity after its live boundary changes',async()=>{
 m.current.mockReturnValue(false);await render();expect(host.textContent).toBe('Public setup');
});
it('requires an explicit server decision and never infers eligibility from a name',async()=>{
 m.session.identity={userId:'actor',fullName:'Owner',companyId:null};await render();expect(host.textContent).toBe('UNAVAILABLE');
});
it('preserves plan selection for eligible unpaid accounts',async()=>{await render();expect(host.textContent).toBe(`Prepare actor ${next}`);});
it('rejects stale account and company decisions',async()=>{
 m.session.identity={userId:'actor',companyId:'company',setupEntry:{kind:'company',userId:'other',companyId:'company'}};
 await render();expect(host.textContent).toBe('UNAVAILABLE');
 m.session.identity={userId:'actor',companyId:'company',setupEntry:{kind:'company',userId:'actor',companyId:'other'}};
 await render();expect(host.textContent).toBe('UNAVAILABLE');
});
it('passes only admitted identifiers into the existing paid flow',async()=>{
 m.session.identity={userId:'actor',companyId:'company',setupEntry:{kind:'company',userId:'actor',companyId:'company'}};
 await render();expect(host.textContent).toBe('Paid actor company');
});
it('does not mount preparation when a company appears',async()=>{
 (m.session.identity as Record<string,unknown>).companyId='company';await render();expect(host.textContent).toBe('UNAVAILABLE');
});
it('preserves profile recovery without mounting private content',async()=>{
 m.session.identity={userId:'actor',setupEntry:{kind:'redirect',target:'complete-profile'}};
 await render();expect(host.textContent).toBe('Public setup');expect(m.replace).toHaveBeenCalledWith(expect.stringContaining('/complete-profile?next='));
});
it('preserves native access denial',async()=>{
 m.session.identity={userId:'actor',setupEntry:{kind:'deny',code:'FORBIDDEN'}};await render();expect(host.textContent).toBe('FORBIDDEN');
});
