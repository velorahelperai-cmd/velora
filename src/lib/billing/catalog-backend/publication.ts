import { validateDraft, type CatalogDraft, type CatalogResult } from "./contract";

type Review = CatalogDraft & { versionId: string; status: "draft" | "published" | "retired" };
type Mutation = (versionId: string, revision: number) => Promise<CatalogResult<{ revision: number; version_id: string }>>;
type PublicationResult = { ok: true; bindingConfirmed: boolean } | { ok: false; code: Extract<CatalogResult<never>, { ok: false }>["code"]; bindingConfirmed: boolean };

/** Eligibility for the installed fixed-price Test contract, never Live readiness. */
export function canBindNouraBasicTestDraft(draft: Review): boolean {
  return draft.status === "draft" && draft.code === "noor_basic" && draft.currency === "OMR"
    && draft.amount_baisa === 45000 && draft.period_unit === "month" && draft.period_count === 1;
}

/** Each mutation remains an authenticated owner RPC. A partial success requires fresh review. */
export async function publishReviewedDraft(draft: Review, revision: number, bindBasic: boolean,
  ports: { bind: Mutation; publish: Mutation }): Promise<PublicationResult> {
  let bindingConfirmed = false;
  if (!validateDraft(draft) || draft.status !== "draft"
    || !/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(draft.versionId)
    || !Number.isSafeInteger(revision) || revision < 1 || (bindBasic && !canBindNouraBasicTestDraft(draft))) {
    return { ok: false, code: "invalid_input", bindingConfirmed };
  }
  const confirmed = (data: { revision: number; version_id: string }, expected: number) =>
    data.version_id === draft.versionId && Number.isSafeInteger(data.revision) && data.revision >= expected;
  try {
    if (bindBasic) {
      const bound = await ports.bind(draft.versionId, revision);
      if (!bound.ok) return { ...bound, bindingConfirmed };
      if (!confirmed(bound.data, revision)) return { ok: false, code: "unavailable", bindingConfirmed };
      bindingConfirmed = true;
      revision = bound.data.revision;
    }
    const published = await ports.publish(draft.versionId, revision);
    if (!published.ok) return { ...published, bindingConfirmed };
    if (!confirmed(published.data, revision)) return { ok: false, code: "unavailable", bindingConfirmed };
    return { ok: true, bindingConfirmed };
  } catch {
    return { ok: false, code: "unavailable", bindingConfirmed };
  }
}
