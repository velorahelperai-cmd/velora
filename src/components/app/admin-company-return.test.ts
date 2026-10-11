import {describe,expect,it} from "vitest";
import {adminCompanyHref,companyListFilters,companyListReturnHref,safeCompanyReturnHref} from "./admin-company-navigation";

describe("company return destination boundary",()=>{
  it.each([
    undefined,null,["/admin"],"https://evil.invalid/admin","//evil.invalid/admin",
    "javascript:alert(1)","/\\evil.invalid/admin","/admin\n","/admin/../login",
    "/admin/%2e%2e/login","/%2f%2fevil.invalid","/administer","/admin/companies/a",
    "/login?next=/admin","/admin?next=https%3A%2F%2Fevil.invalid",
    "/admin?companySearch=a&companySearch=b","/admin?companyStatus=active&companyStatus=setup",
    "/admin#accounts","/admin/billing#companies","/admin/billing?returnTo=/login",
    "/admin/billing?environment=test&environment=live",
  ])("rejects non-list or ambiguous return destination %j",value=>{
    expect(safeCompanyReturnHref(value)).toBe("/admin#companies");
  });
  it("preserves Unicode and URL-like search text as inert query values",()=>{
    const filters={search:"شركة & café / https://example.invalid?x=1#x",status:"active" as const};
    const destination=companyListReturnHref(filters);
    expect(safeCompanyReturnHref(destination)).toBe(destination);
    const detail=new URL(adminCompanyHref("synthetic-company",destination),"https://internal.invalid");
    expect(detail.pathname).toBe("/admin/companies/synthetic-company");
    expect(detail.searchParams.get("returnTo")).toBe(destination);
    expect(companyListFilters(Object.fromEntries(new URL(destination,"https://internal.invalid").searchParams))).toEqual(filters);
  });
  it("preserves the billing list filters and cursor without treating them as authority",()=>{
    const destination="/admin/billing?companyId=synthetic&environment=test&from=2026-10-01&until=2026-10-11&cursor=synthetic%2Bcursor";
    expect(safeCompanyReturnHref(destination)).toBe(destination);
  });
  it.each(["setup","active","suspended","all"])("restores supported status %s",status=>{
    expect(companyListFilters({companySearch:"text",companyStatus:status})).toEqual({search:"text",status});
  });
  it("does not reinterpret repeated query values or unsupported statuses",()=>{
    expect(companyListFilters({companySearch:["a","b"],companyStatus:"owner"})).toEqual({search:"",status:"all"});
  });
});
