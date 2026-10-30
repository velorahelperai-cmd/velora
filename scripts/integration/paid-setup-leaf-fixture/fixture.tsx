import React,{useEffect,useMemo,useRef,useState} from "react";
import {PaidAssistantChecklist,PaidChecklistPersonaVisual,PaidSetupFlow,type PaidChecklistModel,type PaidSetupFlowProps} from "../../../src/components/app/paid-assistant-checklist";
import type {PaidBranchSetupRead,PaidBranchSetupEntryRead} from "../../../src/lib/tenancy/paid-setup-contracts";
import {WhatsappConnectionGuide} from "../../../src/components/app/whatsapp-connection-guide";
export type Options={locale:"ar"|"en";scenario:"normal"|"fixture"|"ready"|"selection"|"flow"};
export function Fixture({options}:{options:Options}){
 if(options.scenario==="flow")return <FlowFixture locale={options.locale}/>;
 return <LeafFixture options={options}/>;
}
function LeafFixture({options}:{options:Options}){
 const [route,setRoute]=useState<"coexistence"|"new-number">("coexistence"),[calls,setCalls]=useState({open:0,launch:0,connect:0}),[hydrated,setHydrated]=useState(false);
 // eslint-disable-next-line react-hooks/set-state-in-effect -- Browser acceptance fixture explicitly exposes completion of client hydration.
 useEffect(()=>setHydrated(true),[]);
 const ready=options.scenario==="ready"||options.scenario==="fixture";
 const model:PaidChecklistModel={schemaVersion:1,sourceStatus:options.scenario==="selection"?"selection_required":"ready",companyId:"synthetic",selectedBranchId:"branch-a",branches:[{id:"branch-a",label:"Synthetic branch"}],entitlement:{slotIndex:0,persona:"level_2",package:"basic",maxChannels:1,employeesExcludingOwner:2},selectedChannels:options.scenario==="selection"?null:["instagram"],steps:(["instagram","hours","knowledge","test","launch"] as const).map((id,i)=>({id,required:true,dependencyIds:i?["instagram"]:[],status:ready?(id==="launch"?"pending":"verified"):(i?"blocked":"pending"),reasonCodes:[],actionId:id})),progress:{denominator:5,verified:ready?4:0,skippedOptional:0},launch:{confirmationRequired:true,confirmed:false,canRequest:ready,blockedReasons:[]},asOf:"2026-10-19T21:00:00Z"};
 return <div data-hydrated={hydrated}><aside className="fixture-tools">LOCAL SYNTHETIC UI TEST <output data-counters>{JSON.stringify(calls)}</output><label>Guide route <select aria-label="Guide route" value={route} onChange={e=>setRoute(e.target.value as typeof route)}><option value="coexistence">Business App</option><option value="new-number">New number</option></select></label></aside>
 <div data-checklist><PaidAssistantChecklist locale={options.locale} model={model} personaName={options.locale==="ar"?"لينا":"Lina"} planName={options.locale==="ar"?"القياسية":"Standard"} personaVisual={<PaidChecklistPersonaVisual persona="level_2" alt="Lina"/>} localFixtureInspection={options.scenario==="fixture"} renderFixtureStep={id=><p data-inert-screen={id}>Inert fixture: {id}</p>} onOpenStep={()=>setCalls(c=>({...c,open:c.open+1}))} onReviewLaunch={()=>setCalls(c=>({...c,launch:c.launch+1}))}/></div>
 <div data-guide><WhatsappConnectionGuide route={route} locale={options.locale} connectEnabled onConnect={()=>setCalls(c=>({...c,connect:c.connect+1}))}/></div></div>;
}

function FlowFixture({locale}:{locale:"ar"|"en"}){
 const [account,setAccount]=useState("account-a"),[hydrated,setHydrated]=useState(false);
 const live=useRef("account-a");
 const pending=useRef<{entry:{account:string;resolve:(r:PaidBranchSetupEntryRead)=>void}[];branch:{account:string;id:string;resolve:(r:PaidBranchSetupRead)=>void}[]}>({entry:[],branch:[]});
 const [reads,setReads]=useState({entry:0,branch:0});
 // eslint-disable-next-line react-hooks/set-state-in-effect -- Browser acceptance fixture explicitly exposes completion of client hydration.
 useEffect(()=>setHydrated(true),[]);
 const port=useMemo(()=>({
  isCurrent:()=>live.current===account,
  readEntry:((input)=>new Promise(resolve=>{pending.current.entry.push({account:input.expectedAccountId,resolve});setReads(c=>({...c,entry:c.entry+1}));})) as PaidSetupFlowProps["readEntry"],
  readBranch:((input)=>new Promise(resolve=>{pending.current.branch.push({account:input.expectedAccountId,id:input.branchId,resolve});setReads(c=>({...c,branch:c.branch+1}));})) as PaidSetupFlowProps["readBranch"],
 }),[account]);
 const resolveEntry=(failed=false)=>{const p=pending.current.entry.shift();if(p)p.resolve({schemaVersion:1,sourceStatus:failed?"unavailable":"selection_required",companyId:p.account+"-company",selectedBranchId:null,branches:failed?[]:[{id:"branch-a",label:"Branch A",isPrimary:true},{id:"branch-b",label:"Branch B",isPrimary:false}],asOf:"synthetic",reasonCodes:[]});};
 const resolveBranch=(id:string,selection=false)=>{const i=pending.current.branch.findIndex(p=>p.id===id);if(i<0)return;const [p]=pending.current.branch.splice(i,1);const ids=["connect_whatsapp","hours","knowledge","assistant_test","launch"] as const;p.resolve({schemaVersion:1,sourceStatus:selection?"selection_required":"ready",companyId:p.account+"-company",selectedBranchId:id,branches:[{id,label:id==="branch-a"?"Branch A":"Branch B"}],entitlement:{orderGroupId:"synthetic",slotIndex:0,persona:"level_2",package:"basic",maxChannels:1,employeesExcludingOwner:2},selectedChannels:selection?null:["whatsapp"],steps:selection?[]:ids.map((id,i)=>({id,required:true,status:i?"blocked":"pending",dependencyIds:i?["connect_whatsapp"]:[],reasonCodes:[],actionId:id})),progress:{denominator:selection?null:5,verified:0,skippedOptional:0},launch:{confirmationRequired:true,confirmed:false,canRequest:false,blockedReasons:["incomplete"]},asOf:"synthetic"});};
 return <div data-hydrated={hydrated}><aside className="fixture-tools">
  <output data-flow-reads>{JSON.stringify(reads)}</output>
  <button onClick={()=>resolveEntry()}>Resolve entry</button><button onClick={()=>resolveEntry(true)}>Fail entry</button>
  <button onClick={()=>resolveBranch("branch-a")}>Resolve A</button><button onClick={()=>resolveBranch("branch-b")}>Resolve B</button><button onClick={()=>resolveBranch("branch-b",true)}>Selection B</button>
  <button onClick={()=>{live.current="account-b";setAccount("account-b");}}>Switch account</button><button onClick={()=>{live.current="expired";}}>Expire capture</button>
 </aside><div data-flow><PaidSetupFlow locale={locale} scope={{expectedAccountId:account,companyId:account+"-company",boundaryFingerprint:account+"-boundary"}} {...port}/></div></div>;
}
