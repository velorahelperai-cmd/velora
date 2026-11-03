import {beforeEach,afterEach,expect,it,vi} from "vitest";
const mocks=vi.hoisted(()=>({log:vi.fn(),copy:vi.fn(),document:vi.fn(),render:vi.fn(),create:vi.fn(),recognize:vi.fn(),terminate:vi.fn()}));
vi.mock("@/lib/logging/logger.mjs",()=>({logEvent:mocks.log}));
vi.mock("node:fs/promises",()=>({mkdtemp:vi.fn(async()=>"scratch-ocr"),copyFile:mocks.copy,rm:vi.fn(async()=>{})}));
vi.mock("unpdf",()=>({getDocumentProxy:mocks.document,renderPageAsImage:mocks.render}));
vi.mock("tesseract.js",()=>({OEM:{LSTM_ONLY:1},createWorker:mocks.create}));
const sourceId="11111111-1111-4111-8111-111111111111";
beforeEach(()=>{
 vi.resetModules();vi.clearAllMocks();
 mocks.copy.mockResolvedValue(undefined);mocks.render.mockResolvedValue(new Uint8Array([1]));
 mocks.document.mockResolvedValue({numPages:1,getPage:async()=>({getViewport:()=>({width:100,height:100})})});
 mocks.recognize.mockResolvedValue({data:{text:"Recognized content"}});mocks.terminate.mockResolvedValue(undefined);
 mocks.create.mockResolvedValue({recognize:mocks.recognize,terminate:mocks.terminate});
});
afterEach(()=>vi.useRealTimers());
it.each([
 ["document","native_extraction","pdf_open_failed"],
 ["copy","local_worker","language_data_unavailable"],
 ["create","local_worker","worker_initialization_failed"],
 ["render","render","render_failed"],
 ["recognize","local_worker","recognition_failed"],
] as const)("classifies %s failure without logging document or exception content",async(target,stage,reason)=>{
 mocks[target].mockRejectedValueOnce(Error("SECRET document text /private/file.pdf"));
 const {readScannedPdf}=await import("./pdf-ocr");
 expect(await readScannedPdf(new Uint8Array([1]),["SECRET native text"],{sourceId})).toBeNull();
 expect(mocks.log).toHaveBeenCalledWith("warn","knowledge.pdf.preparation_failed",expect.objectContaining({stage,failure_code:reason,source_id:sourceId}));
 expect(JSON.stringify(mocks.log.mock.calls)).not.toMatch(/SECRET|private\/file|native text/);
});
it("reports busy without starting a second worker and releases after the first finishes",async()=>{
 let finish!:(value:{data:{text:string}})=>void;mocks.recognize.mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));
 const {readScannedPdf}=await import("./pdf-ocr");const first=readScannedPdf(new Uint8Array([1]),[""],{sourceId});
 await vi.waitFor(()=>expect(mocks.recognize).toHaveBeenCalledOnce());
 expect(await readScannedPdf(new Uint8Array([2]),[""],{sourceId})).toBeNull();
 expect(mocks.log).toHaveBeenCalledWith("warn","knowledge.pdf.preparation_failed",expect.objectContaining({stage:"busy",failure_code:"worker_busy",retry_policy:"after_worker_idle"}));
 expect(mocks.create).toHaveBeenCalledOnce();finish({data:{text:"Complete OCR"}});expect(await first).toBe("Complete OCR");
});
it("reports deadline separately and keeps late worker content unpublished",async()=>{
 vi.useFakeTimers();let finish!:(value:{data:{text:string}})=>void;
 mocks.recognize.mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));
 const {readScannedPdf}=await import("./pdf-ocr");const pending=readScannedPdf(new Uint8Array([1]),[""],{sourceId});
 await vi.advanceTimersByTimeAsync(0);expect(mocks.recognize).toHaveBeenCalledOnce();
 await vi.advanceTimersByTimeAsync(120_001);expect(await pending).toBeNull();
 expect(mocks.log).toHaveBeenCalledWith("warn","knowledge.pdf.preparation_failed",expect.objectContaining({stage:"timeout",failure_code:"ocr_timeout",page:1}));
 finish({data:{text:"Late secret content"}});await vi.advanceTimersByTimeAsync(0);
 expect(JSON.stringify(mocks.log.mock.calls)).not.toContain("Late secret content");
});
it("rejects a caller-supplied text identifier from diagnostics",async()=>{
 const {reportPdfPreparationFailure}=await import("./pdf-ocr");
 reportPdfPreparationFailure("bounds","page_limit",{sourceId:"sensitive filename.pdf",page:-1});
 expect(mocks.log).toHaveBeenCalledWith("warn","knowledge.pdf.preparation_failed",{stage:"bounds",failure_code:"page_limit",source_id:null,page:null,retry_policy:"input_change_required"});
});
