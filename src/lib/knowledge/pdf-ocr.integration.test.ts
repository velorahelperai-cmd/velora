import { existsSync } from "node:fs";
import path from "node:path";
import { createCanvas, GlobalFonts } from "@napi-rs/canvas";
import { expect, it } from "vitest";
import { formatAnswerUserPrompt } from "@/lib/answers/adapters/prompt";
import { extractKnowledgeText } from "./extract";

function mixedPdf(): Uint8Array {
  // A synthetic image must not depend on ambient fonts installed on the CI runner.
  const fontPath = path.resolve(process.cwd(), "public/fonts/velora-loader/Outfit-Variable.ttf");
  expect(existsSync(fontPath)).toBe(true);
  if (!GlobalFonts.has("VeloraOcrFixture")) {
    expect(GlobalFonts.registerFromPath(fontPath, "VeloraOcrFixture")).toBeTruthy();
  }
  expect(GlobalFonts.has("VeloraOcrFixture")).toBe(true);

  const canvasWidth = 1000;
  const canvasHeight = 260;
  const canvas = createCanvas(canvasWidth, canvasHeight);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "white";
  ctx.fillRect(0, 0, canvasWidth, canvasHeight);

  const fontSize = 50;
  const startX = 50;
  const startY = 145;
  ctx.fillStyle = "black";
  ctx.font = `${fontSize}px VeloraOcrFixture`;

  const phrase = "ARCHITECTURAL MODELS";
  const textWidth = ctx.measureText(phrase).width;
  expect(textWidth).toBeGreaterThan(0);
  expect(startX + textWidth).toBeLessThan(canvasWidth - 50);

  ctx.fillText(phrase, startX, startY);

  // Validate that the canvas contains the rendered phrase across its full measured span:
  // start, middle, and end segments must contain drawn dark glyph pixels.
  const startPixels = ctx.getImageData(startX, 0, 30, canvasHeight).data;
  expect(startPixels.some((v, i) => i % 4 !== 3 && v < 200)).toBe(true);

  const midX = Math.round(startX + textWidth / 2);
  const midPixels = ctx.getImageData(midX, 0, 30, canvasHeight).data;
  expect(midPixels.some((v, i) => i % 4 !== 3 && v < 200)).toBe(true);

  const endX = Math.round(startX + textWidth - 30);
  const endPixels = ctx.getImageData(endX, 0, 30, canvasHeight).data;
  expect(endPixels.some((v, i) => i % 4 !== 3 && v < 200)).toBe(true);

  // Right margin must remain clean background to ensure no clipping or overflow occurred.
  const marginPixels = ctx.getImageData(canvasWidth - 30, 0, 30, canvasHeight).data;
  expect(marginPixels.every((v, i) => i % 4 === 3 || v >= 250)).toBe(true);

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
