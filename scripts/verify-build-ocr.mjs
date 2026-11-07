import { existsSync } from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { createCanvas, GlobalFonts } = require("@napi-rs/canvas");

function mixedPdf() {
  const fontPath = path.resolve(process.cwd(), "public/fonts/velora-loader/Outfit-Variable.ttf");
  if (!existsSync(fontPath)) throw new Error("Font not found: " + fontPath);
  if (!GlobalFonts.has("VeloraOcrFixture")) {
    GlobalFonts.registerFromPath(fontPath, "VeloraOcrFixture");
  }

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
  ctx.fillText(phrase, startX, startY);

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
  const parts = [Buffer.from("%PDF-1.4\n")];
  const offsets = [0];
  let size = parts[0].length;
  objects.forEach((object, i) => {
    offsets.push(size);
    const b = Buffer.concat([Buffer.from(`${i + 1} 0 obj\n`), object, Buffer.from("\nendobj\n")]);
    parts.push(b);
    size += b.length;
  });
  const xref = size;
  const table = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.slice(1).map(n => `${String(n).padStart(10, "0")} 00000 n \n`).join("")}trailer << /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return new Uint8Array(Buffer.concat([...parts, Buffer.from(table)]));
}

async function verifyBuildOcr() {
  console.log("1. Loading production route bundle from .next ...");
  require("../.next/server/app/api/internal/knowledge/file-worker/route.js");
  const R = require("../.next/server/chunks/[turbopack]_runtime.js")("server/app/api/internal/knowledge/file-worker/route.js");

  console.log("2. Instantiating built pdf-ocr module (94836) from Turbopack runtime ...");
  const ocrMod = R.m(94836);
  const exports = await ocrMod.exports;
  const { readScannedPdf } = exports;

  if (typeof readScannedPdf !== "function") {
    throw new Error("readScannedPdf is not exported from module 94836");
  }

  console.log("3. Generating mixed PDF fixture (native text + raster image) ...");
  const pdfBytes = mixedPdf();
  const nativePages = ["Company services"];

  console.log("4. Running built readScannedPdf on the mixed PDF ...");
  const t0 = Date.now();
  const extracted = await readScannedPdf(pdfBytes, nativePages, { sourceId: "00000000-0000-4000-8000-000000000001", page: 1 });
  const duration = Date.now() - t0;

  console.log(`5. Extraction completed in ${duration}ms.`);
  console.log("--- EXTRACTED TEXT ---");
  console.log(extracted);
  console.log("----------------------");

  if (!extracted) {
    throw new Error("Extraction returned null!");
  }

  const hasNative = extracted.includes("Company services");
  const hasOcr = extracted.toUpperCase().includes("ARCHITECTURAL MODELS");

  console.log(`Has native text ('Company services'): ${hasNative}`);
  console.log(`Has OCR image text ('ARCHITECTURAL MODELS'): ${hasOcr}`);

  if (!hasNative || !hasOcr) {
    throw new Error(`Assertion failed: native=${hasNative}, ocr=${hasOcr}`);
  }

  console.log("SUCCESS: Both native and OCR image text successfully extracted from the real production build!");
}

verifyBuildOcr().catch((err) => {
  console.error("FATAL ERROR:", err);
  process.exit(1);
});
