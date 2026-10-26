// @vitest-environment jsdom
import {act,createElement} from "react";
import {createRoot,type Root} from "react-dom/client";
import {afterEach,beforeEach,expect,it,vi} from "vitest";
import {LandingChatbot} from "./landing-chatbot";
import {landingCopy} from "@/lib/landing-copy";
vi.mock("next/image",()=>({default:({src,alt}:{src:string;alt:string})=>createElement("img",{src,alt})}));
vi.mock("./conversation-stage",()=>({PhoneStatusBar:()=>null}));
let host:HTMLDivElement,root:Root,section:HTMLElement,notify:IntersectionObserverCallback;
beforeEach(async()=>{Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true});HTMLElement.prototype.scrollTo=vi.fn();vi.stubGlobal("IntersectionObserver",class{constructor(cb:IntersectionObserverCallback){notify=cb;}observe(){}disconnect(){}});section=document.createElement("section");section.id="packages";section.innerHTML='<button>Choose plan</button><div id="packages-chat-slot"></div>';host=document.createElement("div");document.body.append(section,host);root=createRoot(host);await act(async()=>root.render(<LandingChatbot copy={landingCopy("en")}/>));});
afterEach(async()=>{await act(async()=>root.unmount());host.remove();section.remove();vi.unstubAllGlobals();});
const intersection=(visible:boolean)=>notify([{isIntersecting:visible} as IntersectionObserverEntry],{} as IntersectionObserver);
it("docks closed help inside packages and restores floating help outside them",async()=>{expect(host.querySelector('[data-chat-placement="floating"]')).not.toBeNull();await act(async()=>intersection(true));expect(host.querySelector('[data-chat-placement]')).toBeNull();expect(section.querySelector('#packages-chat-slot [data-chat-placement="inline"]')).not.toBeNull();await act(async()=>intersection(false));expect(host.querySelector('[data-chat-placement="floating"]')).not.toBeNull();});
it("keeps the conversation usable inline and Escape restores the launcher",async()=>{await act(async()=>intersection(true));const launcher=section.querySelector<HTMLButtonElement>('button[aria-expanded]')!;await act(async()=>launcher.click());expect(section.querySelector('[role="dialog"]')).not.toBeNull();await act(async()=>section.querySelector('[role="dialog"]')!.dispatchEvent(new KeyboardEvent("keydown",{key:"Escape",bubbles:true})));expect(section.querySelector('[role="dialog"]')).toBeNull();expect(document.activeElement).toBe(section.querySelector('button[aria-expanded]'));});
