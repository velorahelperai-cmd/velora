import type {Metadata} from "next";
import {redirect} from "next/navigation";
import {AccessGate} from "@/components/app/access-gate";
import {AccountPage} from "@/components/app/account-page";
import {getAccountProfile} from "@/lib/tenancy/actions";
import {authFlowHref} from "@/lib/auth/auth-journey";
export const metadata:Metadata={title:"Account · Velora"};
export default async function Page(){
 const result=await getAccountProfile();
 if(!result.ok){if(result.code==="UNAUTHENTICATED")redirect("/login?next=%2Faccount");return <AccessGate code={result.code==="FORBIDDEN"?"FORBIDDEN":"UNAVAILABLE"}/>;}
 if(result.data.emailConfirmed===false)redirect(authFlowHref("/verify-email","/account",result.data.email));
 if(result.data.fullName.trim().length<2)redirect(authFlowHref("/complete-profile","/account"));
 return <AccountPage key={result.data.userId} initial={result.data}/>;
}
