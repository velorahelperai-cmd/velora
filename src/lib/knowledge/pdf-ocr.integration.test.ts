import { createCanvas } from "@napi-rs/canvas";
import { expect, it } from "vitest";
import { formatAnswerUserPrompt } from "@/lib/answers/adapters/prompt";
import { extractKnowledgeText } from "./extract";

function mixedPdf(): Uint8Array {
  const canvas = createCanvas(1000, 260);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "white"; ctx.fillRect(0, 0, 1000, 260);
  ctx.fillStyle = "black"; ctx.font = "bold 66px sans-serif";
  ctx.fillText("ARCHITECTURAL MODELS", 30, 130);
  const jpeg = canvas.toBuffer("image/jpeg");
  const stream = "BT /F1 18 Tf 20 320 Td (Company services) Tj ET\nq 500 0 0 130 20 130 cm /Im0 Do Q";
  const objects = [
    Buffer.from("<< /Type /Catalog /Pages 2 0 R >>"),
    Buffer.from("<< /Type /Pages /Kids [3 0 R] /Count 1 >>"),
    Buffer.from("<< /Type /Page /Parent 2 0 R /MediaBox [0 0 600 400] /Resources << /Font << /F1 5 0 R >> /XObject << /Im0 6 0 R >> >> /Contents 4 0 R >>"),
    Buffer.from(`<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`),
    Buffer.from("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"),
    Buffer.concat([Buffer.from(`<< /Type /XObject /Subtype /Image /Width 1000 /Height 260 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>\nstream\n`), jpeg, Buffer.from("\nendstream")]),
  ];
  const parts: Buffer[] = [Buffer.from("%PDF-1.4\n")];
  const offsets = [0]; let size = parts[0].length;
  objects.forEach((object, i) => { offsets.push(size); const b = Buffer.concat([Buffer.from(`${i + 1} 0 obj\n`), object, Buffer.from("\nendobj\n")]); parts.push(b); size += b.length; });
  const xref = size;
  const table = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.slice(1).map(n => `${String(n).padStart(10, "0")} 00000 n \n`).join("")}trailer << /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return new Uint8Array(Buffer.concat([...parts, Buffer.from(table)]));
}

it("extracts native and image text and places the reviewed content in the answer prompt", async () => {
  const result = await extractKnowledgeText({ fileName: "mixed.pdf", contentType: "application/pdf", bytes: mixedPdf() });
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  expect(result.text).toContain("Company services");
  expect(result.text.toUpperCase()).toContain("ARCHITECTURAL MODELS");
  const prompt = formatAnswerUserPrompt("What services?", [{ sourceId: "reviewed", title: "Services", contentVersion: 1, text: result.text, usageRole: "knowledge" }], "en");
  expect(prompt).toContain("ARCHITECTURAL MODELS");
}, 45_000);
