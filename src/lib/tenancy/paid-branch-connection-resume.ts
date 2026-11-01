import {parsePaidBranchConnectionLaunch,parsePaidBranchConnectionRead,type PaidBranchConnectionLaunch,type PaidBranchConnectionRead,type PaidBranchConnectionScope} from "@/lib/tenancy/paid-branch-connection-contracts";
import type {PaidBranchConnectionRpc} from "@/lib/tenancy/paid-branch-connection-store";

export type WhatsappLaunch=Extract<PaidBranchConnectionLaunch,{flow:"wa_new_number"|"wa_coexistence"}>;
export type ResumeLaunchResult={ok:true;read:PaidBranchConnectionRead;launch:WhatsappLaunch}|{ok:false;code:"not_resumable"|"setup_required"|"source_failed"};
export type ResumeLaunchMaterial={wa_new_number:{appId:string;configId:string;graphVersion:string}|null;wa_coexistence:{appId:string;configId:string;graphVersion:string}|null};

/**
 * F5: re-issues the launch descriptor of an existing, unconsumed, same-session pending attempt.
 * No attempt is created or mutated. The stored descriptor must still match today's server config,
 * otherwise the attempt is not resumed (the user can cancel and start explicitly).
 */
export async function resumeOwnedWhatsappLaunch(client:PaidBranchConnectionRpc,input:PaidBranchConnectionScope&{attemptId:string;sessionId:string},material:ResumeLaunchMaterial):Promise<ResumeLaunchResult>{
 let data:unknown;
 try{
  const result=await client.rpc("es02_b3_resume_owned_branch_launch",{p_expected_account_id:input.expectedAccountId,p_company_id:input.companyId,p_branch_id:input.branchId,p_attempt_id:input.attemptId,p_session_id:input.sessionId});
  if(result.error)return {ok:false,code:"source_failed"};
  data=result.data;
 }catch{return {ok:false,code:"source_failed"};}
 if(!data||typeof data!=="object")return {ok:false,code:"source_failed"};
 const row=data as Record<string,unknown>;
 if(row.ok!==true)return {ok:false,code:"not_resumable"};
 const read=parsePaidBranchConnectionRead(row.read,input);
 const attempt=read?.connection.attempt;
 const flow=read?.connection.flow;
 if(!read||!attempt||attempt.id!==input.attemptId||attempt.status!=="pending"||(flow!=="wa_new_number"&&flow!=="wa_coexistence"))return {ok:false,code:"not_resumable"};
 const launch=parsePaidBranchConnectionLaunch(flow,row.launch,attempt.id);
 if(!launch||launch.flow!==flow)return {ok:false,code:"not_resumable"};
 const current=material[flow];
 if(!current)return {ok:false,code:"setup_required"};
 const typed=launch as WhatsappLaunch;
 if(typed.appId!==current.appId||typed.configId!==current.configId||typed.graphVersion!==current.graphVersion)return {ok:false,code:"not_resumable"};
 return {ok:true,read,launch:typed};
}
