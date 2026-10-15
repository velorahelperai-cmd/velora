import {expect,it,vi} from 'vitest';
import {renderToStaticMarkup} from 'react-dom/server';
vi.mock('./account-chrome',()=>({AccountMenu:()=>null,useOptionalAccountSession:()=>({status:'ready',identity:{userId:'fixture'},isCurrentUser:()=>true})}));
vi.mock('./ui',()=>({LangSwitch:()=>null}));
vi.mock('@/lib/demo-state',()=>({useDemo:()=>({locale:'ar'})}));
import {PrepaymentPreparation} from './prepayment-preparation';
it('renders a blank local form and no payment or server-submit action',()=>{const html=renderToStaticMarkup(<PrepaymentPreparation userId="fixture"/>);expect(html).toContain('مراجعة البيانات محليًا');expect(html).toContain('اسم الفرع');expect(html).not.toContain('<form');expect(html).not.toContain('type="submit"');expect(html).not.toContain('action=');expect(html).not.toContain('type="submit" disabled');expect(html).not.toContain('name="password"');});
