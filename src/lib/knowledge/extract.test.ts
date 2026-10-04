import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import { extractKnowledgeText } from "./extract";

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

    const scanned = await extractKnowledgeText({
      fileName: "scan.pdf",
      contentType: "application/pdf",
      bytes: pdfWithStream(""),
    });
    expect(scanned).toEqual({ ok: false, code: "no_text" });
  });

  it("replaces text instead of appending when run twice", async () => {
    const bytes = new TextEncoder().encode("Classic burger 1.8 OMR today");
    const first = await extractKnowledgeText({ fileName: "menu.txt", contentType: "text/plain", bytes });
    const second = await extractKnowledgeText({ fileName: "menu.txt", contentType: "text/plain", bytes });
    expect(first).toEqual(second);
    if (first.ok && second.ok) expect(second.text.split("Classic burger").length - 1).toBe(1);
  });
});
