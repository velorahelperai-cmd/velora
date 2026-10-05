import { describe, expect, it, vi } from "vitest";
import { loadApprovedAnswerContext, verifyAnswerCitationsStillValid } from "./context";
import type { KnowledgeObjectMeta } from "./file-integrity";

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => {
    throw new Error("tests must inject a client");
  },
}));

const ROW_AT = "2026-10-05T10:00:00.000Z";

type Row = Record<string, unknown>;

function fileRow(over: Row = {}): Row {
  return {
    id: "src-1",
    title: "Hours",
    content: "Daily 10-22",
    content_version: 1,
    approved_version: 1,
    approved_for_answers: true,
    status: "ready",
    kind: "file",
    storage_path: "co-a/src-1/menu.pdf",
    byte_size: 1024,
    updated_at: ROW_AT,
    ...over,
  };
}

function textRow(over: Row = {}): Row {
  return fileRow({ id: "src-text", kind: "text", storage_path: null, byte_size: null, ...over });
}

function intactObject(over: Partial<KnowledgeObjectMeta> = {}): KnowledgeObjectMeta {
  return {
    name: "menu.pdf",
    updated_at: "2026-10-05T09:59:50.000Z",
    metadata: { size: 1024 },
    ...over,
  };
}

function makeChain(result: unknown) {
  const chain = {
    eq: () => chain,
    in: () => chain,
    order: () => chain,
    limit: async () => result,
    then: (resolve: (v: unknown) => void, reject?: (e: unknown) => void) =>
      Promise.resolve(result).then(resolve, reject),
  };
  return chain;
}

function fakeClient(opts: {
  rows: Row[];
  readyProbeCount?: number;
  objects?: Record<string, KnowledgeObjectMeta[]>;
  storageError?: boolean;
}) {
  const listCalls: string[] = [];
  const client = {
    from: () => ({
      select: (_cols: string, options?: { head?: boolean }) =>
        options?.head
          ? makeChain({ count: opts.readyProbeCount ?? opts.rows.length, error: null })
          : makeChain({ data: opts.rows, error: null }),
    }),
    storage: {
      from: () => ({
        list: async (folder: string) => {
          listCalls.push(folder);
          if (opts.storageError) return { data: null, error: { message: "storage unavailable" } };
          return { data: opts.objects?.[folder] ?? [], error: null };
        },
      }),
    },
  };
  return { client: client as never, listCalls };
}

describe("loadApprovedAnswerContext — stale text rejected before generation", () => {
  it("packs an approved file source whose object still matches", async () => {
    const { client, listCalls } = fakeClient({
      rows: [fileRow()],
      objects: { "co-a/src-1": [intactObject()] },
    });
    const packed = await loadApprovedAnswerContext("co-a", client);
    expect(packed.ok).toBe(true);
    if (packed.ok) expect(packed.chunks.map((c) => c.sourceId)).toEqual(["src-1"]);
    expect(listCalls).toEqual(["co-a/src-1"]);
  });

  it("drops a source whose object was deleted or moved away", async () => {
    const { client } = fakeClient({
      rows: [fileRow()],
      objects: { "co-a/src-1": [] },
      readyProbeCount: 1,
    });
    const packed = await loadApprovedAnswerContext("co-a", client);
    expect(packed).toEqual({ ok: false, code: "APPROVAL_INCOMPLETE" });
  });

  it("drops a source whose object was replaced in place after extraction", async () => {
    const { client } = fakeClient({
      rows: [fileRow()],
      objects: { "co-a/src-1": [intactObject({ updated_at: "2026-10-05T11:00:00.000Z" })] },
      readyProbeCount: 1,
    });
    const packed = await loadApprovedAnswerContext("co-a", client);
    expect(packed).toEqual({ ok: false, code: "APPROVAL_INCOMPLETE" });
  });

  it("drops a source whose object size no longer matches", async () => {
    const { client } = fakeClient({
      rows: [fileRow()],
      objects: { "co-a/src-1": [intactObject({ metadata: { size: 55 } })] },
      readyProbeCount: 0,
    });
    const packed = await loadApprovedAnswerContext("co-a", client);
    expect(packed).toEqual({ ok: false, code: "NO_KNOWLEDGE" });
  });

  it("fails closed when Storage cannot be read", async () => {
    const { client } = fakeClient({ rows: [fileRow()], storageError: true });
    const packed = await loadApprovedAnswerContext("co-a", client);
    expect(packed).toEqual({ ok: false, code: "UNAVAILABLE" });
  });

  it("keeps text sources without touching Storage", async () => {
    const { client, listCalls } = fakeClient({ rows: [textRow()] });
    const packed = await loadApprovedAnswerContext("co-a", client);
    expect(packed.ok).toBe(true);
    expect(listCalls).toEqual([]);
  });
});

describe("verifyAnswerCitationsStillValid — stale text rejected before delivery", () => {
  const chunks = [{ sourceId: "src-1", title: "Hours", contentVersion: 1, text: "Daily 10-22" }];

  it("accepts an unchanged object", async () => {
    const { client } = fakeClient({
      rows: [fileRow()],
      objects: { "co-a/src-1": [intactObject()] },
    });
    await expect(verifyAnswerCitationsStillValid("co-a", chunks, client)).resolves.toBe(true);
  });

  it("rejects when the object disappeared mid-answer", async () => {
    const { client } = fakeClient({ rows: [fileRow()], objects: { "co-a/src-1": [] } });
    await expect(verifyAnswerCitationsStillValid("co-a", chunks, client)).resolves.toBe(false);
  });

  it("rejects when the object was replaced mid-answer", async () => {
    const { client } = fakeClient({
      rows: [fileRow()],
      objects: { "co-a/src-1": [intactObject({ updated_at: "2026-10-05T12:00:00.000Z" })] },
    });
    await expect(verifyAnswerCitationsStillValid("co-a", chunks, client)).resolves.toBe(false);
  });

  it("rejects when approval was revoked in the database", async () => {
    const { client } = fakeClient({
      rows: [fileRow({ approved_for_answers: false })],
      objects: { "co-a/src-1": [intactObject()] },
    });
    await expect(verifyAnswerCitationsStillValid("co-a", chunks, client)).resolves.toBe(false);
  });

  it("rejects when the content version moved past the cited version", async () => {
    const { client } = fakeClient({
      rows: [fileRow({ content_version: 2, approved_version: 2 })],
      objects: { "co-a/src-1": [intactObject()] },
    });
    await expect(verifyAnswerCitationsStillValid("co-a", chunks, client)).resolves.toBe(false);
  });

  it("rejects when Storage cannot be read", async () => {
    const { client } = fakeClient({ rows: [fileRow()], storageError: true });
    await expect(verifyAnswerCitationsStillValid("co-a", chunks, client)).resolves.toBe(false);
  });
});
