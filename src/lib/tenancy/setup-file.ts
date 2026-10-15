export type SetupFileScope = { expectedUserId: string; expectedCompanyId: string; draftId: string; generation: number };
export type SetupFileBinding = { path: string; objectId: string; objectUpdatedAt: string; fileName: string; contentType: string; byteSize: number };
export type SetupFileRpc = { rpc: (name: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: unknown }> };
export const isSetupFilePath = (path: string) => /^[a-f0-9-]{36}\/[a-f0-9-]{36}\/setup\/[a-f0-9-]{36}\/[^/]+$/i.test(path);
export function setupFileBinding(value: unknown): SetupFileBinding | null {
  const b = value as Partial<SetupFileBinding> | null;
  return b && typeof b.path === "string" && isSetupFilePath(b.path) && typeof b.objectId === "string" && typeof b.objectUpdatedAt === "string"
    && typeof b.fileName === "string" && typeof b.contentType === "string" && Number.isSafeInteger(b.byteSize) && b.byteSize! > 0 ? b as SetupFileBinding : null;
}
export async function authorizeSetupFile(db: SetupFileRpc, userId: string, companyId: string, sourceId: string) {
  const { data, error } = await db.rpc("master_authorize_setup_file", { p_expected_user_id: userId, p_company_id: companyId, p_source_id: sourceId });
  if (error) return null;
  const r = data as { ok?: boolean; data?: unknown } | null; return r?.ok ? setupFileBinding(r.data) : null;
}
