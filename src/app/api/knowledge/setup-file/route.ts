import { createClient } from "@/lib/supabase/server";
import { getCompanyAccess } from "@/lib/tenancy/access";
import { downloadSetupFile } from "@/lib/tenancy/setup-file-server";
import type { SetupFileRpc } from "@/lib/tenancy/setup-file";
export const runtime = "nodejs";
export async function GET(request: Request) {
  const url = new URL(request.url); const companyId = url.searchParams.get("companyId"); const sourceId = url.searchParams.get("sourceId");
  const access = await getCompanyAccess();
  if (!access.ok || !companyId || !sourceId || access.context.company?.id !== companyId) return new Response(null, { status: 403, headers: { "Cache-Control": "no-store" } });
  try {
    const result = await downloadSetupFile(await createClient() as unknown as SetupFileRpc, access.context.userId, companyId, sourceId);
    if (!result) return new Response(null, { status: 403, headers: { "Cache-Control": "no-store" } });
    return new Response(Buffer.from(result.bytes), { headers: { "Cache-Control": "private, no-store, max-age=0", "Content-Type": "application/octet-stream", "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(result.binding.fileName)}`, "X-Content-Type-Options": "nosniff" } });
  } catch { return new Response(null, { status: 503, headers: { "Cache-Control": "no-store" } }); }
}
