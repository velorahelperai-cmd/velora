import JSZip from "jszip";
import { afterEach, describe, expect, it, vi } from "vitest";
import { extractKnowledgeText } from "./extract";
import * as gemini from "./pdf-gemini-extract";
import * as ocr from "./pdf-ocr";

afterEach(() => {
  delete process.env.VELORA_PDF_GEMINI_EXTRACT_ENABLED;
  delete process.env.VELORA_PDF_GEMINI_EXTRACT_SOURCE_IDS;
  delete process.env.VERCEL_ENV;
});

function pdfWithStream(stream: string, withFont = false) {
  const objects = [
    "1 0 obj<< /Type /Catalog /Pages 2 0 R >>endobj\n",
    "2 0 obj<< /Type /Pages /Kids [3 0 R] /Count 1 >>endobj\n",
    `3 0 obj<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 200] /Contents 4 0 R${withFont ? " /Resources << /Font << /F1 5 0 R >> >>" : ""} >>endobj\n`,
    `4 0 obj<< /Length ${stream.length} >>stream\n${stream}\nendstream\nendobj\n`,
  ];
  if (withFont) objects.push("5 0 obj<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>endobj\n");
  let body = "%PDF-1.4\n";
  const offsets = [0];
  for (const object of objects) {
    offsets.push(body.length);
    body += object;
  }
  const xref = body.length;
  let table = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (let i = 1; i < offsets.length; i += 1) {
    table += `${String(offsets[i]).padStart(10, "0")} 00000 n \n`;
  }
  body += `${table}trailer<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return new Uint8Array(Buffer.from(body));
}

it("keeps the downloaded PDF buffer intact for a verified extraction digest", async () => {
  const bytes = pdfWithStream("BT /F1 12 Tf 20 100 Td (Synthetic approved knowledge) Tj ET", true);
  const original = bytes.slice();
  expect((await extractKnowledgeText({ fileName: "synthetic.pdf", contentType: "application/pdf", bytes })).ok).toBe(true);
  expect(bytes).toEqual(original);
});

async function docxWith(text: string) {
  const zip = new JSZip();
  zip.file(
    "[Content_Types].xml",
    `<?xml version="1.0" encoding="UTF-8"?>
     <Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
       <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
       <Default Extension="xml" ContentType="application/xml"/>
       <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
     </Types>`,
  );
  zip.file(
    "_rels/.rels",
    `<?xml version="1.0" encoding="UTF-8"?>
     <Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
       <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
     </Relationships>`,
  );
  zip.file(
    "word/document.xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
     <w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
       <w:body><w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:body>
     </w:document>`,
  );
  return new Uint8Array(await zip.generateAsync({ type: "uint8array" }));
}

describe("extractKnowledgeText", () => {
  it("routes a scanned PDF through OCR and preserves Arabic and English", async () => {
    const spy = vi.spyOn(ocr, "readScannedPdf").mockResolvedValueOnce("خدمات المجسمات المعمارية\nArchitectural models");
    try {
      const result = await extractKnowledgeText({ fileName: "scan.pdf", contentType: "application/pdf", bytes: pdfWithStream("") });
      expect(result).toEqual({ ok: true, text: "خدمات المجسمات المعمارية\nArchitectural models" });
      expect(spy).toHaveBeenCalledOnce();
    } finally { spy.mockRestore(); }
  });

  it("runs OCR when a page combines native text and an embedded image", async () => {
    const spy = vi.spyOn(ocr, "readScannedPdf").mockResolvedValueOnce("Header text\nنص داخل الصورة");
    try {
      const mixed = pdfWithStream("BT /F1 12 Tf 20 100 Td (Header text) Tj ET\nq 1 0 0 1 0 0 cm BI /W 1 /H 1 /BPC 8 /CS /G /F /AHx ID FF> EI Q", true);
      const result = await extractKnowledgeText({ fileName: "mixed.pdf", contentType: "application/pdf", bytes: mixed });
      expect(result).toEqual({ ok: true, text: "Header text\nنص داخل الصورة" });
      expect(spy).toHaveBeenCalledOnce();
    } finally { spy.mockRestore(); }
  });

  it("does not publish partial text when OCR is unavailable", async () => {
    const spy = vi.spyOn(ocr, "readScannedPdf").mockResolvedValueOnce(null);
    try {
      expect(await extractKnowledgeText({ fileName: "scan.pdf", contentType: "application/pdf", bytes: pdfWithStream("") })).toEqual({ ok: false, code: "extract_failed" });
    } finally { spy.mockRestore(); }
  });

  it("uses allowlisted Gemini for a scanned PDF and skips local OCR", async () => {
    const sourceId = "efbad663-bfe9-4528-b8b3-11d817e20683";
    process.env.VELORA_PDF_GEMINI_EXTRACT_ENABLED = "true";
    process.env.VELORA_PDF_GEMINI_EXTRACT_SOURCE_IDS = sourceId;
    const ocrSpy = vi.spyOn(ocr, "readScannedPdf");
    const geminiSpy = vi.spyOn(gemini, "extractPdfWithGemini").mockResolvedValueOnce("## PAGE 1\nMuscat\n@tajseem_om");
    try {
      const result = await extractKnowledgeText({
        sourceId,
        fileName: "scan.pdf",
        contentType: "application/pdf",
        bytes: pdfWithStream(""),
      });
      expect(result).toEqual({ ok: true, text: "## PAGE 1\nMuscat\n@tajseem_om" });
      expect(geminiSpy).toHaveBeenCalledOnce();
      expect(ocrSpy).not.toHaveBeenCalled();
    } finally {
      geminiSpy.mockRestore();
      ocrSpy.mockRestore();
    }
  });

  it("fails closed when allowlisted Gemini returns nothing, without publishing OCR", async () => {
    const sourceId = "efbad663-bfe9-4528-b8b3-11d817e20683";
    process.env.VELORA_PDF_GEMINI_EXTRACT_ENABLED = "true";
    process.env.VELORA_PDF_GEMINI_EXTRACT_SOURCE_IDS = sourceId;
    const ocrSpy = vi.spyOn(ocr, "readScannedPdf");
    const geminiSpy = vi.spyOn(gemini, "extractPdfWithGemini").mockResolvedValueOnce(null);
    try {
      expect(
        await extractKnowledgeText({
          sourceId,
          fileName: "scan.pdf",
          contentType: "application/pdf",
          bytes: pdfWithStream(""),
        }),
      ).toEqual({ ok: false, code: "extract_failed" });
      expect(ocrSpy).not.toHaveBeenCalled();
    } finally {
      geminiSpy.mockRestore();
      ocrSpy.mockRestore();
    }
  });

  it("rejects OCR output that exceeds the content limit rather than silently truncating it", async () => {
    const spy = vi.spyOn(ocr, "readScannedPdf").mockResolvedValueOnce("x".repeat(200_001));
    try {
      expect(await extractKnowledgeText({ fileName: "scan.pdf", contentType: "application/pdf", bytes: pdfWithStream("") })).toEqual({ ok: false, code: "extract_failed" });
    } finally { spy.mockRestore(); }
  });
  it("reads a text PDF, TXT, and DOCX", async () => {
    const pdf = await extractKnowledgeText({
      fileName: "menu.pdf",
      contentType: "application/pdf",
      bytes: pdfWithStream("BT /F1 18 Tf 40 100 Td (Classic burger 1.8 OMR) Tj ET", true),
    });
    expect(pdf.ok).toBe(true);
    if (pdf.ok) expect(pdf.text).toContain("Classic burger 1.8 OMR");

    const txt = await extractKnowledgeText({
      fileName: "menu.txt",
      contentType: "text/plain",
      bytes: new TextEncoder().encode("Classic burger 1.8 OMR today"),
    });
    expect(txt).toEqual({ ok: true, text: "Classic burger 1.8 OMR today" });

    const docx = await extractKnowledgeText({
      fileName: "menu.docx",
      contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      bytes: await docxWith("Classic burger 1.8 OMR"),
    });
    expect(docx.ok).toBe(true);
    if (docx.ok) expect(docx.text).toContain("Classic burger 1.8 OMR");
  });

  it("rejects a corrupt file and a PDF with no text", async () => {
    const corrupt = await extractKnowledgeText({
      fileName: "broken.pdf",
      contentType: "application/pdf",
      bytes: new TextEncoder().encode("this is not a pdf"),
    });
    expect(corrupt).toEqual({ ok: false, code: "corrupt" });

    const spy = vi.spyOn(ocr, "readScannedPdf").mockResolvedValueOnce("");
    try {
      const scanned = await extractKnowledgeText({
        fileName: "scan.pdf",
        contentType: "application/pdf",
        bytes: pdfWithStream(""),
      });
      expect(scanned).toEqual({ ok: false, code: "no_text" });
    } finally { spy.mockRestore(); }
  });

  it("replaces text instead of appending when run twice", async () => {
    const bytes = new TextEncoder().encode("Classic burger 1.8 OMR today");
    const first = await extractKnowledgeText({ fileName: "menu.txt", contentType: "text/plain", bytes });
    const second = await extractKnowledgeText({ fileName: "menu.txt", contentType: "text/plain", bytes });
    expect(first).toEqual(second);
    if (first.ok && second.ok) expect(second.text.split("Classic burger").length - 1).toBe(1);
  });
});
