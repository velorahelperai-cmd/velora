import {parseTeamDirectory, type DirectoryRequest, type TeamResult} from "./contracts";
import type {TeamScope} from "./ui-state";

export function teamQuery(actorId:string,params:URLSearchParams):TeamResult<DirectoryRequest>{
 if(["team","search","cursor"].some(key=>params.getAll(key).length>1))return {ok:false,code:"INVALID_INPUT"};
 let cursor:unknown=null;
 try{const raw=params.get("cursor");if(raw){if(raw.length>1024)return {ok:false,code:"INVALID_INPUT"};cursor=JSON.parse(raw);}}catch{return {ok:false,code:"INVALID_INPUT"};}
 const values={expectedUserId:actorId,teamId:params.get("team")||null,search:params.get("search")??"",pageSize:25,cursor};
 // Cursor belongs to navigation only. Changed actor/search/team starts a fresh page.
 const request=parseTeamDirectory(values)??parseTeamDirectory({...values,cursor:null});
 return request?{ok:true,data:request}:{ok:false,code:"INVALID_INPUT"};
}
export function teamHref(path:"/admin/teams"|"/account/teams",scope:TeamScope):string{
 const query=new URLSearchParams();if(scope.teamId)query.set("team",scope.teamId);
 if(scope.search.trim())query.set("search",scope.search.trim());
 if(scope.cursor)query.set("cursor",JSON.stringify(scope.cursor));
 return query.size?`${path}?${query}`:path;
}
