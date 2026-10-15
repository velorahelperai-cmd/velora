import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {describe,expect,it} from 'vitest';
import {SetupReviewPrerequisites} from './setup-review-prerequisites';
import {SmartSetupCards} from './smart-setup-cards';
import {buildSetupPageView} from './setup-page-view';
import {buildSmartOnboarding} from '@/lib/tenancy/smart-onboarding';
const props={ar:true,knowledgeReady:false,hoursRequired:true,hoursReady:false,channelsSelected:false,subscriptionActive:false};
describe('visible page navigation and independent review requirements',()=>{
 it.each([true,false])('explains missing review prerequisites outside this page in locale ar=%s',ar=>{
  const html=renderToStaticMarkup(createElement(SetupReviewPrerequisites,{...props,ar}));
  expect(html).toContain('href="/app/knowledge"');expect(html).toContain('href="/app/settings?tab=business"');
  expect(html).not.toContain('href="/app/settings?tab=whatsapp"');
  expect(html).toContain(ar?'بعد الدفع':'follows payment');
 });
 it('offers channel management only after an active subscription and never changes any gate',()=>{
  const html=renderToStaticMarkup(createElement(SetupReviewPrerequisites,{...props,knowledgeReady:true,hoursReady:true,subscriptionActive:true}));
  expect(html).not.toContain('href="/app/knowledge"');expect(html).not.toContain('tab=business');
  expect(html).toContain('href="/app/settings?tab=whatsapp"');expect(html).not.toContain('<form');expect(html).not.toContain('<button');
 });
 it('renders exactly four reachable regions, sequential numbers and explicit page-data progress',()=>{
  const smart=buildSmartOnboarding({company:null,branchSetup:null,knowledge:'not_started',contract:null,review:null,reviewLoadFailed:false,operationalChannels:[]});
  const view=buildSetupPageView(smart,null,null);
  const html=renderToStaticMarkup(createElement(SmartSetupCards,{...view,locale:'ar',progressKind:'page',onOpen:()=>{},activeCardId:'subscription'},createElement('p',null,'plan-editor')));
  expect(html.match(/data-setup-section=/g)).toHaveLength(4);expect(html.match(/aria-controls=/g)).toHaveLength(4);
  for(const id of ['knowledge','language','hours','trial','channels'])expect(html).not.toContain(`data-setup-section="${id}"`);
  expect(html).toContain('اكتمال بيانات الصفحة');expect(html).toContain('ولا تعني جاهزية التشغيل');expect(html).toContain('>4</span>');expect(html).not.toContain('>5</span>');
  expect(html.match(/plan-editor/g)).toHaveLength(1);
 });
});
