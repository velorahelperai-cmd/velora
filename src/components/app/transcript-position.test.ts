import {expect,it} from 'vitest';
import {captureTranscriptPosition,restoreTranscriptPosition} from './transcript-position';
it('keeps an observed message at its screen offset when older messages are inserted',()=>{
 let offset=25;
 const anchor={dataset:{messageId:'message'},getBoundingClientRect:()=>({top:offset,bottom:offset+40})};
 const node={scrollTop:100,scrollHeight:1000,clientHeight:300,getBoundingClientRect:()=>({top:0}),querySelectorAll:()=>[anchor]} as unknown as HTMLElement;
 const position=captureTranscriptPosition(node);expect(position.atEnd).toBe(false);offset=225;
 restoreTranscriptPosition(node,position);expect(node.scrollTop).toBe(300);
});
it('follows new messages only if the reader was already at the end',()=>{
 const fixture={scrollTop:700,scrollHeight:1000,clientHeight:300,getBoundingClientRect:()=>({top:0}),querySelectorAll:()=>[]};
 const node=fixture as unknown as HTMLElement;
 const position=captureTranscriptPosition(node);fixture.scrollHeight=1200;restoreTranscriptPosition(node,position);expect(node.scrollTop).toBe(1200);
});
