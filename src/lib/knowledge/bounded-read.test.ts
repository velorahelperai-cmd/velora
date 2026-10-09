import { describe, expect, it, vi } from "vitest";
import { readBoundedKnowledgeStream } from "./bounded-read";

describe("bounded knowledge file read", () => {
  it("returns exactly the streamed extraction bytes", async () => {
    const stream = new ReadableStream<Uint8Array>({ start(c) { c.enqueue(new Uint8Array([97])); c.enqueue(new Uint8Array([98, 99])); c.close(); } });
    expect(await readBoundedKnowledgeStream(stream, new AbortController().signal)).toEqual(new Uint8Array([97,98,99]));
  });
  it("cancels the body as soon as the byte limit is exceeded", async () => {
    const cancel = vi.fn();
    const stream = new ReadableStream<Uint8Array>({ start(c) { c.enqueue(new Uint8Array([1,2,3,4])); }, cancel });
    await expect(readBoundedKnowledgeStream(stream, new AbortController().signal, 3)).rejects.toThrow("FILE_LIMIT");
    expect(cancel).toHaveBeenCalledOnce();
  });
  it("cancels an in-progress body on timeout and never returns partial bytes", async () => {
    const cancel = vi.fn();
    const stream = new ReadableStream<Uint8Array>({ cancel });
    await expect(readBoundedKnowledgeStream(stream, AbortSignal.timeout(5))).rejects.toThrow("FILE_UNAVAILABLE");
    expect(cancel).toHaveBeenCalledOnce();
  });
});
