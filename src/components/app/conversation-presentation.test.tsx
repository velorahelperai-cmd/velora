// @vitest-environment jsdom
import {afterEach,beforeEach,expect,it} from 'vitest';
import {act,useState} from 'react';
import {createRoot,type Root} from 'react-dom/client';
import {ComposerTabs,type ComposerMode} from './conversation-presentation';
import {ConversationDetailsPanel} from './conversation-details-panel';

let host:HTMLDivElement,root:Root;
beforeEach(()=>{Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true});host=document.createElement('div');document.body.append(host);root=createRoot(host);});
afterEach(()=>{act(()=>root.unmount());host.remove();document.body.style.overflow='';});

it('uses RTL keyboard order and keeps the message editor mounted while selecting notes or AI',()=>{
 function Harness(){const [mode,setMode]=useState<ComposerMode>('message');return <><ComposerTabs id="test" mode={mode} onChange={setMode} ar/><div id="test-panel-message" hidden={mode!=='message'}><textarea defaultValue="Unsaved reply"/></div><div id="test-panel-note" hidden={mode!=='note'}>Internal only</div><div id="test-panel-ai" hidden={mode!=='ai'}>Requires confirmation</div></>;}
 act(()=>root.render(<Harness/>));
 const input=host.querySelector('textarea')!;
 const tabs=host.querySelectorAll<HTMLButtonElement>('[role="tab"]');
 tabs[0].focus();act(()=>tabs[0].dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowLeft',bubbles:true})));
 expect(tabs[1].getAttribute('aria-selected')).toBe('true');expect(document.activeElement).toBe(tabs[1]);
 expect(host.querySelector('textarea')).toBe(input);expect(input.value).toBe('Unsaved reply');
 expect(input.parentElement?.hidden).toBe(true);
 act(()=>tabs[1].dispatchEvent(new KeyboardEvent('keydown',{key:'End',bubbles:true})));
 expect(tabs[2].getAttribute('aria-selected')).toBe('true');
 act(()=>tabs[2].dispatchEvent(new KeyboardEvent('keydown',{key:'Home',bubbles:true})));
 expect(tabs[0].getAttribute('aria-selected')).toBe('true');expect(input.value).toBe('Unsaved reply');
});

it('closes the details drawer with Escape or backdrop, restores focus, and retains its draft',()=>{
 function Harness(){const [open,setOpen]=useState(false);return <><button id="opener" onClick={()=>setOpen(true)}>Details</button><ConversationDetailsPanel id="details" title="Customer" open={open} onClose={()=>setOpen(false)}><textarea defaultValue="Unsaved note"/></ConversationDetailsPanel></>;}
 act(()=>root.render(<Harness/>));
 const opener=host.querySelector<HTMLButtonElement>('#opener')!;opener.focus();act(()=>opener.click());
 const input=host.querySelector('textarea')!;
 expect(host.querySelector('[role="dialog"]')?.getAttribute('aria-modal')).toBe('true');expect(document.body.style.overflow).toBe('hidden');
 act(()=>document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true})));
 expect(host.querySelector('[role="dialog"]')).toBe(null);expect(document.activeElement).toBe(opener);expect(document.body.style.overflow).toBe('');
 act(()=>opener.click());act(()=>host.querySelector<HTMLButtonElement>('.conversation-details-backdrop')!.click());
 expect(host.querySelector('[role="dialog"]')).toBe(null);expect(host.querySelector('textarea')).toBe(input);expect(input.value).toBe('Unsaved note');
});
