import {expect,it} from "vitest";
import {emptyBranchHours,validateBranchHours,prepareBranchHoursSave,prepareBranchHoursCopy,branchHoursAssistantContext,type BranchHoursSnapshot} from "./branch-hours-contracts";
const scope={expectedAccountId:"owner",companyId:"company",branchId:"source"};
const snapshot:BranchHoursSnapshot={scope,version:3,branchLabel:"Main",timezone:"Asia/Muscat",schedule:emptyBranchHours()};
const period=(start:string,end:string,nextDay=false)=>({state:"open" as const,intervals:[{start,end,nextDay}]});
it("preserves unset versus closed without declaring readiness",()=>{
 const s=emptyBranchHours();s.monday={state:"closed"};const r=validateBranchHours(s);
 expect(r.ok).toBe(true);if(r.ok){expect(r.schedule.monday.state).toBe("closed");expect(r.schedule.tuesday.state).toBe("unset");expect(r).not.toHaveProperty("ready");}
});
it.each(["24:00","9:00","12:60",""])("rejects invalid local clock %s",start=>{
 expect(validateBranchHours({...emptyBranchHours(),monday:period(start,"17:00")})).toMatchObject({ok:false,issues:[{code:"invalid_time"}]});
});
it("requires explicit midnight crossing and permits an explicit 24-hour interval",()=>{
 expect(validateBranchHours({...emptyBranchHours(),monday:period("22:00","02:00")})).toMatchObject({ok:false});
 expect(validateBranchHours({...emptyBranchHours(),monday:period("22:00","02:00",true)}).ok).toBe(true);
 expect(validateBranchHours({...emptyBranchHours(),monday:period("00:00","00:00",true)}).ok).toBe(true);
 expect(validateBranchHours({...emptyBranchHours(),monday:period("00:00","00:00")})).toMatchObject({ok:false});
});
it("accepts separate and touching intervals but rejects overlap",()=>{
 const s=emptyBranchHours();s.monday={state:"open",intervals:[{start:"09:00",end:"12:00",nextDay:false},{start:"12:00",end:"17:00",nextDay:false}]};
 expect(validateBranchHours(s).ok).toBe(true);s.monday.intervals[1].start="11:59";
 expect(validateBranchHours(s)).toMatchObject({ok:false,issues:[{code:"overlap"}]});
});
it("detects overnight conflicts across adjacent days and week boundary",()=>{
 expect(validateBranchHours({...emptyBranchHours(),monday:period("22:00","02:00",true),tuesday:period("01:00","03:00")})).toMatchObject({ok:false,issues:[{code:"overlap"}]});
 expect(validateBranchHours({...emptyBranchHours(),sunday:period("22:00","02:00",true),monday:period("01:00","03:00")})).toMatchObject({ok:false,issues:[{code:"overlap"}]});
});
it("rejects malformed and empty open days",()=>{
 expect(validateBranchHours({})).toMatchObject({ok:false});
 expect(validateBranchHours({...emptyBranchHours(),monday:{state:"open",intervals:[]}})).toMatchObject({ok:false});
 expect(validateBranchHours({...emptyBranchHours(),monday:{state:"closed",intervals:[]}})).toMatchObject({ok:false});
});
it("guards scope/version/unknown timezone and clones a save draft",()=>{
 expect(prepareBranchHoursSave({...scope,branchId:"other"},snapshot,snapshot.schedule)).toEqual({ok:false,code:"scope"});
 expect(prepareBranchHoursSave(scope,{...snapshot,version:-1},snapshot.schedule)).toEqual({ok:false,code:"version"});
 expect(prepareBranchHoursSave(scope,{...snapshot,timezone:null},snapshot.schedule)).toEqual({ok:false,code:"timezone"});
 const r=prepareBranchHoursSave(scope,snapshot,snapshot.schedule);expect(r.ok).toBe(true);if(r.ok){r.draft.schedule.monday={state:"closed"};expect(snapshot.schedule.monday.state).toBe("unset");}
});
const targets=[{branchId:"target",label:"London",timezone:"Europe/London",version:7}];
it.each(["closed","unset","open"])("rejects array state [%s] through validation, save and copy",state=>{
 const malformed={...emptyBranchHours(),monday:{state:[state]}};
 expect(validateBranchHours(malformed)).toMatchObject({ok:false,issues:[{code:"invalid_day",day:"monday"}]});
 expect(prepareBranchHoursSave(scope,snapshot,malformed)).toEqual({ok:false,code:"schedule"});
 expect(prepareBranchHoursCopy(scope,snapshot,malformed,targets,["target"])).toEqual({ok:false,code:"schedule"});
});
it.each([[],["source"],["missing"],["target","target"]].map(selected=>({selected})))("requires an explicit valid distinct destination list $selected",({selected})=>{
 expect(prepareBranchHoursCopy(scope,snapshot,snapshot.schedule,targets,selected)).toEqual({ok:false,code:"selection"});
});
it("copies local clock values unchanged without a timezone mutation",()=>{
 const s={...emptyBranchHours(),monday:period("22:00","02:00",true)};
 const r=prepareBranchHoursCopy(scope,snapshot,s,targets,["target"]);expect(r.ok).toBe(true);
 if(r.ok){expect(r.draft.source.schedule).toEqual(s);expect(r.draft.mode).toBe("local-weekday-clock");expect(r.draft.targets).toEqual([{branchId:"target",expectedVersion:7}]);expect(r.draft).not.toHaveProperty("timezone");}
});
it("rejects unknown target zones and ambiguous inventory",()=>{
 expect(prepareBranchHoursCopy(scope,snapshot,snapshot.schedule,[{...targets[0],timezone:null}],["target"])).toEqual({ok:false,code:"timezone"});
 expect(prepareBranchHoursCopy(scope,snapshot,snapshot.schedule,[targets[0],targets[0]],["target"])).toEqual({ok:false,code:"selection"});
});

it("retains isolated calendar exceptions through validation, cloning and save",()=>{
 const schedule={...emptyBranchHours(),exceptions:[{date:"2028-02-29",hours:{state:"closed" as const}}]};
 const result=prepareBranchHoursSave(scope,snapshot,schedule);
 expect(result.ok).toBe(true);
 if(result.ok){expect(result.draft.schedule.exceptions).toEqual(schedule.exceptions);schedule.exceptions[0].date="2028-03-01";expect(result.draft.schedule.exceptions![0].date).toBe("2028-02-29");}
});
it.each(["2026-02-29","2026-13-01","2026-04-31","26-01-01",""])("rejects invalid exception date %s",date=>{
 expect(validateBranchHours({...emptyBranchHours(),exceptions:[{date,hours:{state:"closed"}}]}).ok).toBe(false);
});
it("rejects duplicate, unset, malformed and overnight date exceptions",()=>{
 const entry={date:"2026-12-01",hours:{state:"closed"}};
 for(const exceptions of [[entry,entry],[{...entry,hours:{state:"unset"}}],[{...entry,extra:true}],[{...entry,hours:period("22:00","02:00",true)}],new Array(1)])
 expect(validateBranchHours({...emptyBranchHours(),exceptions}).ok).toBe(false);
});
it("accepts split special hours and rejects exception overlap or sparse intervals",()=>{
 const hours={state:"open",intervals:[{start:"09:00",end:"12:00",nextDay:false},{start:"13:00",end:"17:00",nextDay:false}]};
 const schedule={...emptyBranchHours(),exceptions:[{date:"2026-12-01",hours}]};
 expect(validateBranchHours(schedule).ok).toBe(true);hours.intervals[1].start="11:00";expect(validateBranchHours(schedule).ok).toBe(false);
 hours.intervals=new Array(1);expect(validateBranchHours(schedule).ok).toBe(false);
});
it("AI context explains full-date overrides and fails closed on invalid context",()=>{
 const saved={...snapshot,schedule:{...emptyBranchHours(),exceptions:[{date:"2026-12-01",hours:{state:"closed" as const}}]}};
 expect(branchHoursAssistantContext(saved)).toContain("including weekly carry-over");
 expect(branchHoursAssistantContext(saved)).toContain("2026-12-01");
 expect(branchHoursAssistantContext({...saved,timezone:null})).toBeNull();
 expect(branchHoursAssistantContext({...saved,schedule:{...saved.schedule,exceptions:[{date:"bad",hours:{state:"closed"}}]}})).toBeNull();
});

it("permits date exception intervals ending at midnight including a full day",()=>{
 for(const start of ["00:00","22:00"]) expect(validateBranchHours({...emptyBranchHours(),exceptions:[{date:"2026-12-01",hours:period(start,"00:00",true)}]}).ok).toBe(true);
});
