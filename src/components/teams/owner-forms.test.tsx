import {beforeEach,expect,it,vi} from "vitest";
import {parseTeamMutation,type Team} from "@/lib/platform-teams/contracts";
import {teamCopy} from "./copy";
const state=vi.hoisted(()=>({slots:[] as unknown[],cursor:0,review:vi.fn(),snapshot:{} as Record<string,unknown>}));
vi.mock("react",async()=>({...await vi.importActual<typeof import("react")>("react"),useState:()=>[state.slots[state.cursor++],vi.fn()],useSyncExternalStore:()=>state.snapshot}));
vi.mock("@/lib/tenancy/actions",()=>({adminSearchAccounts:vi.fn()}));
vi.mock("@/lib/access/actions",()=>({accessGetUserSnapshot:vi.fn()}));
vi.mock("@/lib/platform-teams/actions",()=>({readPlatformTeamDirectory:vi.fn()}));
vi.mock("@/components/app/ui",()=>({Button:"button",Card:"section",Field:"field",Notice:"aside",useUnsavedWarning:()=>{}}));
const subject=await import("./team-owner-editor");
const id=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,"0")}`;
const actor=id(1),manager=id(2);
type Node={type:unknown;props:Record<string,unknown>};
function nodes(v:unknown):Node[]{if(Array.isArray(v))return v.flatMap(nodes);if(!v||typeof v!=="object"||!("props"in v))return[];const n=v as Node;return[n,...nodes(n.props.children)];}
const store={review:state.review,invalidateReview:vi.fn(),subscribe:vi.fn(),getSnapshot:()=>state.snapshot,readDraft:vi.fn(),saveDraft:vi.fn()};
beforeEach(()=>{vi.clearAllMocks();state.cursor=0;state.snapshot={review:null};state.slots=["New team","active","Owner approved change",{userId:manager,label:"Actual manager"}];});
it("create submits only accepted create keys; no undefined update-status field blocks saving",()=>{
 expect(subject.TeamForm).toBeTypeOf("function");
 const tree=subject.TeamForm({actorId:actor,copy:teamCopy("en"),team:null,store:store as never});
 (nodes(tree).find(n=>n.type==="form")!.props.onSubmit as (e:unknown)=>void)({preventDefault(){}});
 const request=state.review.mock.calls[0][0];expect(parseTeamMutation(request)).not.toBeNull();expect(request).not.toHaveProperty("status");expect(request.managerUserId).toBe(manager);expect(request.expectedTeamRevision).toBe(0);
});
it("disabling a team preserves its captured revision and explicitly clears its manager",()=>{
 expect(subject.TeamForm).toBeTypeOf("function");state.slots[1]="disabled";
 const team:Team={id:id(3),name:"New team",status:"active",revision:8,managerUserId:manager};
 const tree=subject.TeamForm({actorId:actor,copy:teamCopy("ar"),team,store:store as never});
 (nodes(tree).find(n=>n.type==="form")!.props.onSubmit as (e:unknown)=>void)({preventDefault(){}});
 const request=state.review.mock.calls[0][0];expect(parseTeamMutation(request)).not.toBeNull();expect(request.managerUserId).toBeNull();expect(request.expectedTeamRevision).toBe(8);expect(request.status).toBe("disabled");
});
it("confirmation keeps the existing form mounted and disables editing so Cancel retains its draft",()=>{
 state.snapshot={review:{op:"create",name:"New team",reason:"Owner approved change"},preview:null};
 const tree=subject.TeamOwnerEditor({actorId:actor,copy:teamCopy("en"),directory:{kind:"teams",rows:[],total:0,nextCursor:null,team:null},selection:null,onSelection:vi.fn(),store:store as never});
 expect(nodes(tree).find(n=>n.type==="fieldset")!.props.disabled).toBe(true);expect(nodes(tree).some(n=>n.type===subject.TeamForm)).toBe(true);
});
it("entered reasons use the same-context draft store without browser persistence",()=>{
 const tree=subject.TeamForm({actorId:actor,copy:teamCopy("en"),team:null,store:store as never});
 const reason=nodes(tree).find(n=>n.props.value==="Owner approved change")!;
 (reason.props.onChange as (v:string)=>void)("Retain this reason");expect(store.saveDraft).toHaveBeenCalledWith("team:new:reason","Retain this reason");
});
