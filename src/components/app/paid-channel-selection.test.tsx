// @vitest-environment jsdom
import {act,createElement} from "react";
import {createRoot,type Root} from "react-dom/client";
import {afterEach,beforeEach,expect,it,vi} from "vitest";
import {projectSelectionRequired} from "@/lib/tenancy/paid-setup-contracts";
import {PaidChannelSelection} from "./paid-channel-selection";
const save=vi.hoisted(()=>vi.fn());
vi.mock("@/lib/tenancy/paid-setup-actions",()=>({selectOwnedPaidBranchChannelsAction:save}));
const scope={expectedAccountId:"actor",companyId:"company",branchId:"branch",boundaryFingerprint:"boundary"};
const read=projectSelectionRequired({companyId:"company",branchId:"branch",branchLabel:"TAG CITY",orderGroupId:"order",slotIndex:0,persona:"level_1",package:"basic",term:"monthly",maxChannels:1,employeesExcludingOwner:2,clockState:"waiting_readiness",asOf:"now"});
let host:HTMLDivElement,root:Root,current:boolean;
const refresh=vi.fn();
beforeEach(()=>{vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT",true);save.mockReset();refresh.mockReset();current=true;host=document.createElement("div");document.body.append(host);root=createRoot(host);});
afterEach(async()=>{await act(async()=>root.unmount());host.remove();vi.unstubAllGlobals();});
async function render(extra={}){await act(async()=>root.render(createElement(PaidChannelSelection,{locale:"en",scope,read,isCurrent:()=>current,onRefresh:refresh,...extra})));}
async function click(selector:string){await act(async()=>host.querySelector<HTMLElement>(selector)!.click());}
it("offers channels for a new paid branch and limits Basic to one",async()=>{await render();expect(host.textContent).toContain("Choose your branch channels");expect(host.querySelector<HTMLButtonElement>('button[type="submit"]')!.disabled).toBe(true);await click('input[value="whatsapp"]');expect(host.querySelector<HTMLInputElement>('input[value="instagram"]')!.disabled).toBe(true);save.mockResolvedValue({ok:true,code:"selected",companyId:"company",branchId:"branch"});await click('button[type="submit"]');expect(save).toHaveBeenCalledWith({...scope,boundaryFingerprint:undefined,clientOpId:expect.any(String),channels:["whatsapp"]});expect(refresh).toHaveBeenCalledOnce();});
it("allows both Premium channels without manufacturing readiness",async()=>{await render({read:{...read,entitlement:{...read.entitlement!,package:"premium",maxChannels:2,employeesExcludingOwner:4}}});await click('input[value="whatsapp"]');await click('input[value="instagram"]');save.mockResolvedValue({ok:false,code:"unavailable"});await click('button[type="submit"]');expect(save.mock.calls[0]![0].channels).toEqual(["whatsapp","instagram"]);expect(refresh).not.toHaveBeenCalled();expect(host.querySelector('[role="alert"]')).not.toBeNull();});
it("reuses the operation ID after an uncertain failure and fences a stale response",async()=>{await render();await click('input[value="whatsapp"]');save.mockRejectedValueOnce(Error("offline"));await click('button[type="submit"]');const first=save.mock.calls[0]![0].clientOpId;save.mockImplementationOnce(async()=>{current=false;return {ok:true,companyId:"company",branchId:"branch"};});await click('button[type="submit"]');expect(save.mock.calls[1]![0].clientOpId).toBe(first);expect(refresh).not.toHaveBeenCalled();});
it("blocks duplicate submits while saving and rereads an already-bound branch",async()=>{await render();await click('input[value="whatsapp"]');let finish!:(value:unknown)=>void;save.mockReturnValue(new Promise(resolve=>{finish=resolve;}));await act(async()=>{host.querySelector('form')!.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));host.querySelector('form')!.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));});expect(save).toHaveBeenCalledOnce();await act(async()=>finish({ok:false,code:"already_selected"}));expect(refresh).toHaveBeenCalledOnce();});
it.each(["foreign","unpaid","stale"])("does not expose a selection for %s",async kind=>{await render(kind==="foreign"?{scope:{...scope,branchId:"foreign"}}:kind==="unpaid"?{read:{...read,entitlement:null}}:{isCurrent:()=>false});expect(host.querySelector("form")).toBeNull();expect(save).not.toHaveBeenCalled();});
