import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {describe,expect,it} from 'vitest';
import {SmartSetupCards} from './smart-setup-cards';
import type {SmartSetupCard,SetupCardId} from '@/lib/tenancy/smart-onboarding';
const ids:SetupCardId[]=['profile','branches','knowledge','language','hours','trial','channels','subscription','review'];
const cards:SmartSetupCard[]=ids.map((id,index)=>({id,status:index===0?'ready':'not_started',required:!['hours','trial','subscription'].includes(id),missing:null,step:id==='branches'?null:index}));
const props={locale:'ar' as const,cards,percent:33,completedRequired:2,totalRequired:6,onOpen:()=>{}};
describe('inline setup accordion',()=>{
 it('keeps all nine sections in contract order and shows one inline editor',()=>{
  const html=renderToStaticMarkup(createElement(SmartSetupCards,{...props,activeCardId:'branches',onClose:()=>{}},createElement('form',{'data-editor':'branches'},'existing-editor')));
  expect(html.match(/data-setup-section=/g)).toHaveLength(9);
  const positions=ids.map(id=>html.indexOf(`data-setup-section="${id}"`));
  expect(positions.every((position,index)=>index===0||position>positions[index-1])).toBe(true);
  expect(html.match(/aria-expanded="true"/g)).toHaveLength(1);
  expect(html.indexOf('existing-editor')).toBeGreaterThan(positions[1]);
  expect(html.indexOf('existing-editor')).toBeLessThan(positions[2]);
  expect(html.match(/<form/g)).toHaveLength(1);
  expect(html).toContain('aria-valuenow="33"');
  expect(html).toContain('2/6');
 });
 it('renders independent accessible toggles and preserves required/optional flags',()=>{
  const html=renderToStaticMarkup(createElement(SmartSetupCards,{...props,activeCardId:null}));
  expect(html.match(/aria-expanded="false"/g)).toHaveLength(9);
  expect(html.match(/aria-controls=/g)).toHaveLength(9);
  expect(html).toContain('اختياري');expect(html).toContain('مطلوب');
  expect(html).toContain('data-setup-guide');
  expect(html).not.toContain('تم الحفظ');
  expect(html).not.toContain('تفاصيل المالك');
 });
 it('leaves the legacy editor in place when smart setup is disabled',()=>{
  const html=renderToStaticMarkup(createElement(SmartSetupCards,{...props,enabled:false},createElement('form',null,'legacy-editor')));
  expect(html).toBe('<form>legacy-editor</form>');
 });
});
