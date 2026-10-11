import {describe,it,expect} from "vitest";
const id=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,"0")}`;
const base={expectedUserId:id(1),operationId:id(1000),reason:" Synthetic owner change "};
const create={...base,op:"create",teamId:id(101),name:" Team A ",managerUserId:id(2),expectedTeamRevision:0};
const transfer={...base,op:"transfer",sourceTeamId:id(101),destinationTeamId:id(102),userId:id(4),expectedSourceRevision:2,expectedDestinationRevision:2,expectedMemberRevision:1,expectedDestinationMemberRevision:0};
const contracts=()=>import("./contracts");
describe("internal team runtime contracts",()=>{
 it("normalizes the approved owner operation without accepting access grants",async()=>{const {parseTeamMutation}=await contracts();expect(parseTeamMutation(create)).toMatchObject({expectedUserId:id(1),payload:{op:"create",name:"Team A",reason:"Synthetic owner change",manager_user_id:id(2)}});expect(parseTeamMutation({...create,companyId:id(201)})).toBeNull();expect(parseTeamMutation({...create,capabilities:["platform.manage_admins"]})).toBeNull();});
 it.each([null,[],{},"text",{...create,expectedUserId:id(7),expectedTeamRevision:-1},{...create,operationId:"bad"},{...create,reason:" "},{...create,name:"x"},{...create,name:"x".repeat(121)},{...create,expectedTeamRevision:1.5},{...create,expectedTeamRevision:"0"}])("rejects malformed request %j",async input=>{expect((await contracts()).parseTeamMutation(input)).toBeNull();});
 it("requires both team/member revision pairs and distinct teams for a transfer",async()=>{const {parseTeamMutation}=await contracts();expect(parseTeamMutation(transfer)).not.toBeNull();expect(parseTeamMutation({...transfer,destinationTeamId:transfer.sourceTeamId})).toBeNull();expect(parseTeamMutation({...transfer,expectedDestinationMemberRevision:undefined})).toBeNull();});
 it("accepts known empty self state but rejects malformed or cross-user membership",async()=>{const {decodeTeamSelf}=await contracts();expect(decodeTeamSelf({ok:true,memberships:[]},id(1))).toEqual({ok:true,data:{memberships:[]}});expect(decodeTeamSelf({ok:true},id(1))).toMatchObject({ok:false,code:"UNAVAILABLE"});expect(decodeTeamSelf({ok:true,membership:{user_id:id(7)},team:null,manager:null},id(1))).toMatchObject({ok:false,code:"UNAVAILABLE"});});
 it("does not fabricate directory rows/counts/cursors from an incomplete response",async()=>{const {decodeTeamDirectory}=await contracts();const input={teamId:null,cursor:null,pageSize:25};expect(decodeTeamDirectory({ok:true,kind:"teams",rows:[],total:0,next_cursor:null,team:null},input)).toMatchObject({ok:true,data:{total:0,rows:[]}});for(const bad of[{ok:true},{ok:true,kind:"teams",rows:[],total:-1,next_cursor:null,team:null},{ok:true,kind:"teams",rows:[{}],total:1,next_cursor:null,team:null}])expect(decodeTeamDirectory(bad,input)).toMatchObject({ok:false,code:"UNAVAILABLE"});});
 it("requires confirmed operation/revision identity; failure codes remain distinct",async()=>{const {decodeTeamMutation,parseTeamMutation}=await contracts();const request=parseTeamMutation(create)!;expect(decodeTeamMutation({ok:false,code:"CONFLICT"},request.payload)).toEqual({ok:false,code:"CONFLICT"});expect(decodeTeamMutation({ok:false,code:"forged"},request.payload)).toEqual({ok:false,code:"UNAVAILABLE"});expect(decodeTeamMutation({ok:true,op:"create",operation_id:id(999),team_id:id(101),revision:1},request.payload)).toEqual({ok:false,code:"UNAVAILABLE"});});
 it("decodes employee/manager summaries and rejects a stale manager edge",async()=>{
  const {decodeTeamSelf}=await contracts();const team={id:id(101),name:"Team A",status:"active",revision:2,manager_user_id:id(2)};
  const employee={access:"active",team,membership:{team_id:id(101),user_id:id(4),status:"active",revision:1,specialty:"",role:"employee"},manager:{user_id:id(2),full_name:"Manager A"}};
  expect(decodeTeamSelf({ok:true,memberships:[employee]},id(4))).toMatchObject({ok:true,data:{memberships:[{manager:{userId:id(2)}}]}});
  expect(decodeTeamSelf({ok:true,memberships:[{...employee,manager:{user_id:id(3),full_name:"Old manager"}}]},id(4))).toEqual({ok:false,code:"UNAVAILABLE"});
  expect(decodeTeamSelf({ok:true,memberships:[{...employee,membership:{...employee.membership,user_id:id(2),role:"manager"},manager:null}]},id(2))).toMatchObject({ok:true,data:{memberships:[{manager:null}]}});
 });
 it("accepts a scoped roster page and rejects cross-team rows, order and forged continuation",async()=>{
  const {decodeTeamDirectory}=await contracts();const request={teamId:id(101),cursor:null,pageSize:1};
  const response={ok:true,kind:"members",team:{id:id(101),name:"Team A",status:"active",revision:2,manager_user_id:id(2)},rows:[{team_id:id(101),user_id:id(2),status:"active",revision:1,specialty:"",role:"manager",full_name:"Manager A"}],total:2,next_cursor:{id:id(2),revision:1}};
  expect(decodeTeamDirectory(response,request)).toMatchObject({ok:true,data:{total:2,nextCursor:{id:id(2)}}});
  for(const bad of [{...response,rows:[{...response.rows[0],team_id:id(102)}]},{...response,next_cursor:{id:id(7),revision:1}}])expect(decodeTeamDirectory(bad,request)).toEqual({ok:false,code:"UNAVAILABLE"});
  expect(decodeTeamDirectory(response,{...request,cursor:{id:id(2),revision:1}})).toEqual({ok:false,code:"UNAVAILABLE"});
 });
 it("decodes preview and confirmed transfer projections; rejects wrong revision or destination",async()=>{
  const {parseTeamMutation,decodeTransferPreview,decodeTeamMutation}=await contracts();const request=parseTeamMutation(transfer)!.payload;
  const source={id:id(101),name:"Team A",status:"active",revision:2,manager_user_id:id(2)},destination={id:id(102),name:"Team B",status:"active",revision:2,manager_user_id:id(3)};
  const member={team_id:id(101),user_id:id(4),status:"active",revision:1,specialty:""};
  const preview={ok:true,source_team:source,destination_team:destination,source_member:member,destination_member:null,manager_before:{user_id:id(2)},manager_after:{user_id:id(3)}};
  expect(decodeTransferPreview(preview,request)).toMatchObject({ok:true,data:{managerAfter:id(3),destinationMember:null}});
  expect(decodeTransferPreview({...preview,source_team:{...source,revision:3}},request)).toEqual({ok:false,code:"UNAVAILABLE"});
  const confirmed={ok:true,operation_id:id(1000),op:"transfer",source_team:{...source,revision:3},destination_team:{...destination,revision:3},source_member:{...member,status:"disabled",revision:2},destination_member:{...member,team_id:id(102),revision:1}};
  expect(decodeTeamMutation(confirmed,request)).toMatchObject({ok:true,data:{destinationMember:{teamId:id(102),status:"active"}}});
  expect(decodeTeamMutation({...confirmed,destination_member:{...confirmed.destination_member,team_id:id(101)}},request)).toEqual({ok:false,code:"UNAVAILABLE"});
 });
 it("decodes plural own memberships including denied status without accepting colleague metadata",async()=>{
  const {decodeTeamSelf}=await contracts();const denied={membership:{team_id:id(101),user_id:id(4),status:"disabled",revision:2,role:"employee",specialty:"Finance"},team:null,manager:null,access:"denied"};
  expect(decodeTeamSelf({ok:true,memberships:[denied]},id(4))).toMatchObject({ok:true,data:{memberships:[{access:"denied",membership:{specialty:"Finance"}}]}});
  expect(decodeTeamSelf({ok:true,memberships:[{...denied,membership:{...denied.membership,user_id:id(7)}}]},id(4))).toEqual({ok:false,code:"UNAVAILABLE"});
 });
 it("normalizes optional specialty and bounded directory search without accepting authority fields",async()=>{
  const {parseTeamMutation,parseTeamDirectory}=await contracts();expect(parseTeamMutation({...base,op:"set_member",teamId:id(101),userId:id(4),status:"active",expectedTeamRevision:2,expectedMemberRevision:1,specialty:" Finance "})).toMatchObject({payload:{specialty:"Finance"}});
  expect(parseTeamDirectory({expectedUserId:id(1),search:" Team A "})).toMatchObject({search:"Team A"});
 });
});
