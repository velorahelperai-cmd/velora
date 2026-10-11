import {redirect} from "next/navigation";
import {readSessionIdentity} from "@/lib/auth/server-identity";
import {readAccountPlatformIdentity} from "@/lib/tenancy/account-platform-identity";
import {readPlatformTeamDirectory} from "@/lib/platform-teams/actions";
import {teamQuery} from "@/lib/platform-teams/ui-routing";
import {TeamsPage,TeamsFailure} from "./teams-page";

export type TeamSearchParams=Promise<Record<string,string|string[]|undefined>>;
export async function renderTeamsRoute(editor:boolean,searchParams:TeamSearchParams){
 const path=editor?"/admin/teams":"/account/teams";
 const identity=await readSessionIdentity();
 if(!identity.ok){if(identity.code==="UNAUTHENTICATED")redirect(`/login?next=${encodeURIComponent(path)}`);return <TeamsFailure code="UNAVAILABLE"/>;}
 if(!identity.emailConfirmed)redirect(`/verify-email?next=${encodeURIComponent(path)}`);
 if(editor){
  const role=await readAccountPlatformIdentity(identity.userId);
  if(role.unavailable)return <TeamsFailure code="UNAVAILABLE"/>;
  if(role.role!=="owner"||role.status!=="active")return <TeamsFailure code="FORBIDDEN"/>;
 }
 const query=new URLSearchParams();
 for(const [key,value]of Object.entries(await searchParams)){if(Array.isArray(value))value.forEach(v=>query.append(key,v));else if(value!==undefined)query.set(key,value);}
 const scope=teamQuery(identity.userId,query);if(!scope.ok)return <TeamsFailure code={scope.code}/>;
 // This route needs a verified session and R3 team scope, never a dummy company grant.
 const directory=await readPlatformTeamDirectory(scope.data);
 if(!directory.ok)return <TeamsFailure code={directory.code}/>;
 return <TeamsPage key={identity.userId} actorId={identity.userId} editor={editor}/>;
}
