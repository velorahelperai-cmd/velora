import {redirect} from "next/navigation";
import {readSessionIdentity} from "@/lib/auth/server-identity";
import {readAccountPlatformIdentity} from "@/lib/tenancy/account-platform-identity";
import {teamQuery} from "@/lib/platform-teams/ui-routing";
import {TeamsPage,TeamsFailure} from "./teams-page";

export type TeamSearchParams=Promise<Record<string,string|string[]|undefined>>;
export async function renderTeamsRoute(editor:boolean,searchParams:TeamSearchParams){
 const path=editor?"/admin/teams":"/account/teams";
 const identity=await readSessionIdentity();
 if(!identity.ok){if(identity.code==="UNAUTHENTICATED")redirect(`/login?next=${encodeURIComponent(path)}`);return <TeamsFailure embedded={editor} code="UNAVAILABLE"/>;}
 if(!identity.emailConfirmed)redirect(`/verify-email?next=${encodeURIComponent(path)}`);
 if(editor){
  const role=await readAccountPlatformIdentity(identity.userId);
  if(role.unavailable)return <TeamsFailure embedded={editor} code="UNAVAILABLE"/>;
  if(role.role!=="owner"||role.status!=="active")return <TeamsFailure embedded={editor} code="FORBIDDEN"/>;
 }
 const query=new URLSearchParams();
 for(const [key,value]of Object.entries(await searchParams)){if(Array.isArray(value))value.forEach(v=>query.append(key,v));else if(value!==undefined)query.set(key,value);}
 const scope=teamQuery(identity.userId,query);if(!scope.ok)return <TeamsFailure embedded={editor} code={scope.code}/>;
 // Render only the shell here. The client performs the one directory read via
 // the existing native action (identity before/after + SQL team authorization).
 // A server preflight fetched and discarded the same rows before that read.
 return <TeamsPage key={`${identity.userId}:${identity.boundaryFingerprint}:${editor}`} actorId={identity.userId} editor={editor}/>;
}
