export type TranscriptPosition={atEnd:boolean;anchor:string|null;offset:number;top:number};
export function captureTranscriptPosition(node:HTMLElement):TranscriptPosition {
 const edge=node.getBoundingClientRect().top;
 const anchor=[...node.querySelectorAll<HTMLElement>('[data-message-id]')].find(el=>el.getBoundingClientRect().bottom>edge);
 return {atEnd:node.scrollHeight-node.scrollTop-node.clientHeight<32,anchor:anchor?.dataset.messageId??null,offset:anchor?anchor.getBoundingClientRect().top-edge:0,top:node.scrollTop};
}
export function restoreTranscriptPosition(node:HTMLElement,position?:TranscriptPosition) {
 if(!position||position.atEnd){node.scrollTop=node.scrollHeight;return;}
 const anchor=[...node.querySelectorAll<HTMLElement>('[data-message-id]')].find(el=>el.dataset.messageId===position.anchor);
 if(anchor)node.scrollTop+=anchor.getBoundingClientRect().top-node.getBoundingClientRect().top-position.offset;
 else node.scrollTop=position.top;
}
