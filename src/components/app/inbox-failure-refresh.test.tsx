import { beforeEach, expect, it, vi } from "vitest";
import type { ComponentProps } from "react";
import { appCopy } from "@/lib/app-copy";
type Slot = { value?: unknown; deps?: unknown[] };
const state = vi.hoisted(() => ({ slots: [] as Slot[], cursor: 0, effects: [] as Array<()=>void>, refresh: vi.fn() }));
vi.mock("react", async () => {
 const actual = await vi.importActual<typeof import("react")>("react");
 const slot=()=>state.slots[state.cursor++]??(state.slots[state.cursor-1]={});
 const changed=(a:unknown[]|undefined,b:unknown[])=>!a||a.length!==b.length||b.some((v,i)=>!Object.is(a[i],v));
 const memo=(fn:()=>unknown,deps:unknown[])=>{const s=slot();if(changed(s.deps,deps)){s.value=fn();s.deps=deps;}return s.value;};
 return {...actual,
  useState(initial:unknown){const s=slot();if(!("value" in s))s.value=typeof initial==="function"?(initial as ()=>unknown)():initial;return [s.value,(v:unknown)=>{s.value=typeof v==="function"?(v as (x:unknown)=>unknown)(s.value):v;}];},
  useRef(value:unknown){const s=slot();if(!s.value)s.value={current:value};return s.value;},
  useMemo:memo,useCallback:(fn:()=>unknown,deps:unknown[])=>memo(()=>fn,deps),
  useEffect:()=>{},
  useLayoutEffect(fn:()=>void,deps:unknown[]){const s=slot();if(changed(s.deps,deps)){state.effects.push(fn);s.deps=deps;}},
  useTransition:()=>[false,(fn:()=>unknown)=>fn()],
 };
});
vi.mock("next/navigation",()=>({useRouter:()=>({refresh:vi.fn(),replace:vi.fn()}),useSearchParams:()=>new URLSearchParams()}));
vi.mock("@/lib/demo-state",()=>({useDemo:()=>({locale:"en"})}));
vi.mock("./ui",()=>({Button:"button",Notice:"aside",EmptyState:"section",useAppCopy:()=>appCopy("en")}));
vi.mock("./workspace-shell",()=>({WorkspaceShell:"main"}));
vi.mock("@/lib/whatsapp/actions",()=>({controlWhatsappConversation:vi.fn(),replyWhatsappConversation:vi.fn(),upsertConversationLeadState:vi.fn()}));
vi.mock("@/lib/whatsapp/inbox-actions",()=>({refreshWhatsappInboxInitialPage:state.refresh,refreshWhatsappInboxPage:vi.fn(),refreshWhatsappThreadPage:vi.fn(),refreshWhatsappControlAuditPage:vi.fn(),refreshWhatsappConnectionStatus:async()=>({ok:false,code:"UNAVAILABLE"}),markWhatsappThreadSeen:vi.fn()}));
import { ConversationsPage } from "./conversations";
type Node={props:Record<string,unknown>};
function nodes(value:unknown):Node[]{if(Array.isArray(value))return value.flatMap(nodes);if(!value||typeof value!=="object"||!("props" in value))return [];const n=value as Node;return[n,...nodes(n.props.children),...nodes(n.props.actions)];}
function text(value:unknown):string{if(Array.isArray(value))return value.map(text).join(" ");if(value&&typeof value==="object"&&"props" in value)return text((value as Node).props.children);return typeof value==="string"?value:"";}
const company="11111111-1111-4111-8111-111111111111";
function initial():ComponentProps<typeof ConversationsPage>{return {inbox:[],meta:{companyId:company,conversationScope:"all_company",timezone:null,timezoneAnnouncedUtc:true,canReply:false,canAssign:false,assignees:[],counts:{all:0,awaiting_staff:0,follow_up_today:0,overdue:0,trial_or_quote:0}},page:{companyId:company,conversationScope:"all_company",kind:"partial",ordering:"newest_created",conversations:[],hasMore:false,nextCursor:null,total:0,unreadTotal:0,interventionTotal:0,membershipFingerprint:"d41d8cd98f00b204e9800998ecf8427e"}};}
function render(props:ComponentProps<typeof ConversationsPage>){state.cursor=0;let tree=ConversationsPage(props);while(state.effects.length){state.effects.splice(0).forEach(fn=>fn());state.cursor=0;tree=ConversationsPage(props);}return tree;}
beforeEach(()=>{state.slots=[];state.cursor=0;state.effects=[];vi.clearAllMocks();});
it.each(["unavailable","no-company","success"])("new route %s replaces a refresh denial",async next=>{
 const props=initial();let tree=render(props);state.refresh.mockResolvedValue({ok:false,code:"FORBIDDEN"});
 const refresh=nodes(tree).find(n=>n.props.title==="Refresh inbox")!;
 await (refresh.props.onClick as ()=>Promise<void>)();tree=render(props);
 expect(text(tree)).toContain(appCopy("en").errors.forbiddenBody);
 const nextProps=next==="success"?initial():{inbox:[],loadFailed:next==="unavailable",noCompany:next==="no-company"};
 tree=render(nextProps);
 expect(text(tree)).not.toContain(appCopy("en").errors.forbiddenBody);
 if(next==="unavailable")expect(text(tree)).toContain(appCopy("en").app.inboxLoadFailedBody);
 if(next==="no-company")expect(text(tree)).toContain(appCopy("en").app.inboxNoCompanyBody);
});
