// @vitest-environment jsdom
import {act} from 'react';
import {createRoot} from 'react-dom/client';
import {afterEach,expect,it,vi} from 'vitest';
const mocks=vi.hoisted(()=>({action:vi.fn(),advance:vi.fn()}));
vi.mock('@/lib/account-deletion/actions',()=>({accountDeletionAction:mocks.action,advanceAccountDeletion:mocks.advance}));
import {AccountDeletionPanel} from './account-deletion-panel';
const receipt={id:'operation',target:'target',actor:'owner',createdAt:'2026-10-25T00:00:00Z',expiresAt:'2026-10-25T00:05:00Z',fingerprint:'fingerprint',items:[{identity:'shared',relation:'companies',key:{id:'shared'},category:'shared',reason:'SHARED_BUSINESS'}],states:{STORAGE:'PENDING'},fenced:false,isTest:false};
let root:ReturnType<typeof createRoot>|null=null;
afterEach(async()=>{if(root)await act(()=>root?.unmount());document.body.innerHTML='';vi.clearAllMocks();});
it('binds confirmation to target UUID and preview and shows shared data explicitly',async()=>{
 mocks.action.mockResolvedValue({ok:true,data:receipt});
 const host=document.createElement('div');document.body.append(host);root=createRoot(host);
 await act(async()=>{root?.render(<AccountDeletionPanel target="target" email="user@synthetic.invalid"/>);});
 await act(async()=>{(host.querySelector('button') as HTMLButtonElement).click();});
 expect(document.body.textContent).toContain('مشترك وسيبقى');
 const confirm=[...document.body.querySelectorAll('button')].find(b=>b.textContent?.includes('تأكيد الحذف النهائي'))!;
 expect(confirm.disabled).toBe(true);
 const input=document.body.querySelector('input[aria-label="اكتب معرّف الحساب للتأكيد"]') as HTMLInputElement;
 await act(async()=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(input,'target');input.dispatchEvent(new Event('input',{bubbles:true}));});
 expect(mocks.action.mock.calls[0]).toEqual(['preview',expect.objectContaining({target:'target'})]);
});
it('a lost request gives status recovery, never a false success',async()=>{
 mocks.action.mockRejectedValue(Error('network'));
 const host=document.createElement('div');document.body.append(host);root=createRoot(host);
 await act(async()=>{root?.render(<AccountDeletionPanel target="target" email="user@synthetic.invalid"/>);});
 await act(async()=>{(host.querySelector('button') as HTMLButtonElement).click();});
 expect(document.body.textContent).toContain('تعذر حسم النتيجة');
 expect(document.body.textContent).toContain('فحص الحالة');
});

it('opens outside the table, restores focus on Escape, and locks background scrolling',async()=>{
 mocks.action.mockResolvedValue({ok:true,data:receipt});
 const host=document.createElement('div');document.body.append(host);root=createRoot(host);
 await act(async()=>root?.render(<AccountDeletionPanel target="target" email="user@synthetic.invalid"/>));
 const trigger=host.querySelector('button')!;trigger.focus();
 await act(async()=>trigger.click());
 const dialog=document.querySelector('[role="dialog"]');expect(dialog).not.toBeNull();expect(host.contains(dialog)).toBe(false);
 expect(document.body.style.overflow).toBe('hidden');expect(dialog?.contains(document.activeElement)).toBe(true);
 await act(async()=>document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true})));
 expect(document.querySelector('[role="dialog"]')).toBeNull();expect(document.activeElement).toBe(trigger);expect(document.body.style.overflow).toBe('');
});
