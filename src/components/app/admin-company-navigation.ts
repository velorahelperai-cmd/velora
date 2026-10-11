import {safeInternalPath} from "@/lib/auth/safe-next";
import type {CompanyStatus} from "@/lib/tenancy/types";

export type CompanyListFilters = {search:string;status:"all"|CompanyStatus};
export function companyListFilters(query:Record<string,string|string[]|undefined>):CompanyListFilters {
  const status=query.companyStatus;
  return {search:typeof query.companySearch==="string"?query.companySearch:"",
    status:status==="active"||status==="setup"||status==="suspended"?status:"all"};
}
export function companyListReturnHref(filters:CompanyListFilters):string {
  const query=new URLSearchParams();
  if(filters.search)query.set("companySearch",filters.search);
  if(filters.status!=="all")query.set("companyStatus",filters.status);
  return "/admin"+(query.size?"?"+query.toString():"")+"#companies";
}

/** A detail return is navigation only, never an authorization decision. */
export function safeCompanyReturnHref(raw:unknown):string {
  const fallback="/admin#companies";
  const candidate=safeInternalPath(typeof raw==="string"?raw:undefined,"");
  if(!candidate)return fallback;
  const url=new URL(candidate,"https://internal.invalid");
  const path=candidate.split(/[?#]/)[0];
  const allowed=path==="/admin"?["companySearch","companyStatus"]:
    path==="/admin/billing"?["companyId","environment","from","until","cursor"]:null;
  if(!allowed||(url.hash&&!(path==="/admin"&&url.hash==="#companies")))return fallback;
  for(const key of url.searchParams.keys()){
    if(!allowed.includes(key)||url.searchParams.getAll(key).length!==1)return fallback;
  }
  return path==="/admin"
    ?companyListReturnHref(companyListFilters(Object.fromEntries(url.searchParams)))
    :url.pathname+url.search;
}

export function adminCompanyHref(companyId:string,returnTo:string):string {
  return `/admin/companies/${encodeURIComponent(companyId)}?`+
    new URLSearchParams({returnTo:safeCompanyReturnHref(returnTo)}).toString();
}
