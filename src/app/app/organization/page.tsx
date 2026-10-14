import Link from "next/link";
import { getCompanyAccess } from "@/lib/tenancy/access";
import { readEnterpriseWorkspace } from "@/lib/enterprise/actions";
import { EnterpriseOrganization } from "@/components/app/enterprise-organization";
import { enterpriseLifecycleEnabled } from "@/lib/enterprise/config";
import { notFound } from "next/navigation";
export const metadata={title:"Organization · Velora"};
export default async function Page(){
 if(!enterpriseLifecycleEnabled())notFound();
 const access=await getCompanyAccess();
 if(!access.ok||!access.context.company)return <main className="p-8" role="alert">تعذر التحقق من الوصول إلى المؤسسة. <Link href="/app/settings">الإعدادات</Link></main>;
 const result=await readEnterpriseWorkspace(access.context.userId,access.context.company.id);
 if(!result.ok)return <main className="p-8" role="alert">إدارة الفروع غير متاحة حاليًا. أعد التحقق من حسابك أو تواصل مع الدعم. <Link href="/app/settings">الإعدادات</Link></main>;
 return <EnterpriseOrganization key={`${result.data.companyId}:${result.data.userId}`} initial={result.data}/>;
}
