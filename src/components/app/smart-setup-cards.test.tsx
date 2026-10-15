import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {describe,expect,it} from 'vitest';
import {SmartSetupCards} from './smart-setup-cards';
import type {SmartSetupCard} from '@/lib/tenancy/smart-onboarding';
const cards:SmartSetupCard[]=[{id:'profile',status:'ready',required:true,missing:null,step:0},{id:'hours',status:'not_started',required:false,missing:'hours',step:2},{id:'channels',status:'needs_attention',required:true,missing:'channel_verification',step:5}];
describe('flexible setup cards',()=>{
 it.each(['ar','en'] as const)('renders %s progress with semantic independent actions',locale=>{
  const html=renderToStaticMarkup(createElement(SmartSetupCards,{locale,cards,percent:67,completedRequired:2,totalRequired:3,onOpen:()=>{}}));
  expect(html).toContain('aria-valuenow="67"');expect(html).toContain('aria-valuemax="100"');
  expect(html.match(/<button/g)).toHaveLength(3);
  expect(html).toContain(locale==='ar'?'اختياري':'Optional');
  expect(html).toContain(locale==='ar'?'تحقق من':'Verify');
  expect(html).not.toContain('Milestone');expect(html).not.toContain('محطة');
 });
});
