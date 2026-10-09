import "server-only";
import { getSecureProviderKey } from "../config/env";
export function safeProviderError(error:unknown) {
 const value=error as {status?:number;message?:string};
 let message=String(value?.message??"Provider request failed");
 for(const provider of ["openai","google"] as const){const key=getSecureProviderKey(provider);if(key)message=message.split(key).join("[REDACTED]");}
 message=message.replace(/sk-[A-Za-z0-9_-]{12,}|AIza[A-Za-z0-9_-]{20,}|AQ\.[A-Za-z0-9_-]{20,}|Bearer\s+[A-Za-z0-9._~+/=-]+/g,"[REDACTED]");
 const status=Number(value?.status)||null;
 return {status,message:message.slice(0,300),code:status?`PROVIDER_HTTP_${status}`:"PROVIDER_NETWORK_ERROR"};
}
