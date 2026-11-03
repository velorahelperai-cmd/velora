import { notFound } from 'next/navigation';
import { requirePlatformOwner } from '@/lib/tenancy/access';
import { QaBusinessReset } from '@/components/admin/qa-business-reset';
import { createClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Velora Admin - إدارة وتصفير تجارب QA' };

export default async function Page() {
  const owner = await requirePlatformOwner();
  if (!owner.ok) notFound();

  const client = await createClient();
  const { data, error } = await client.rpc('es02_admin_list_qa_setup' as never);
  const result = data as {
    ok?: boolean;
    grants?: Array<{
      companyId: string;
      name: string;
      persona: string;
      package: string;
      term: string;
    }>;
  } | null;

  if (error || !result?.ok) {
    return (
      <div dir="rtl" className="max-w-2xl mx-auto p-6">
        <div className="p-4 rounded-2xl border border-red-500/20 bg-red-500/5 text-red-700 text-sm font-medium">
          تعذر قراءة تجارب QA من قاعدة البيانات. لم يتغير أي سجل.
        </div>
      </div>
    );
  }

  return <QaBusinessReset grants={result.grants ?? []} />;
}
