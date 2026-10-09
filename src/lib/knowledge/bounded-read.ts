import { KNOWLEDGE_MAX_FILE_BYTES } from "./constants";

export async function readBoundedKnowledgeStream(stream: ReadableStream<Uint8Array>, signal: AbortSignal, maxBytes = KNOWLEDGE_MAX_FILE_BYTES): Promise<Uint8Array> {
  const reader = stream.getReader();
  const abort = () => { void reader.cancel().catch(() => {}); };
  signal.addEventListener("abort", abort, { once: true });
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    if (signal.aborted) { abort(); throw Error("FILE_UNAVAILABLE"); }
    for (;;) {
      const part = await reader.read();
      if (signal.aborted) throw Error("FILE_UNAVAILABLE");
      if (part.done) break;
      size += part.value.byteLength;
      if (size > Math.min(maxBytes, KNOWLEDGE_MAX_FILE_BYTES)) { await reader.cancel(); throw Error("FILE_LIMIT"); }
      chunks.push(part.value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    return bytes;
  } finally { signal.removeEventListener("abort", abort); reader.releaseLock(); }
}
