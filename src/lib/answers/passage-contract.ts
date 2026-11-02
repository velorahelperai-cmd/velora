/** Native SQL offsets count Unicode code points, not JavaScript UTF-16 units. */
export type ApprovedPassage = { start_char: number; end_char: number; text: string };
export const PASSAGE_SEPARATOR = "\n\n[...]\n\n";

export function validPassageEnvelope(row: Record<string, unknown>): boolean {
  if (row.retrieval_mode === undefined && row.passages === undefined) return true;
  if (row.retrieval_mode !== "passages_v1" || row.usage_role !== "knowledge"
    || !Array.isArray(row.passages) || row.passages.length < 1 || row.passages.length > 6) return false;
  const texts: string[] = [];
  let previousStart = 0;
  let previousEnd = 0;
  for (const value of row.passages) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return false;
    const p = value as Record<string, unknown>;
    if (!Number.isSafeInteger(p.start_char) || !Number.isSafeInteger(p.end_char)
      || typeof p.text !== "string") return false;
    const start = Number(p.start_char), end = Number(p.end_char);
    const size = Array.from(p.text).length;
    if (start < 1 || start <= previousStart || end <= start || end - start !== size
      || size > 1800 || start < previousEnd - 200) return false;
    previousStart = start; previousEnd = end; texts.push(p.text);
  }
  return row.content === texts.join(PASSAGE_SEPARATOR);
}
