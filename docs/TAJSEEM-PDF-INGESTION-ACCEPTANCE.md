# PDF ingestion acceptance: TAJSEEM split test (2026-10-31)

A manually imported FAQ/text source is NOT evidence of PDF ingestion. Never mark the file pipeline complete from answers available in that source.

Owner-approved split: existing text source 2f07ce01-b1fd-46bd-ba6a-31a2a883feab retains reviewed pages 1-8 only. Pages 9-17 remain a local reference, not another inserted source. Original file source efbad663-bfe9-4528-b8b3-11d817e20683 remains failed until real processing succeeds.

Clean acceptance question: What Instagram handle is listed on the portfolio contact page? Expected @tajseem_om, page17. Absent from pages1-8 and both other approved branch texts, verified read-only. Do not use general project names: page7 already lists all six.

Minimal implementation proposal, not implemented:
1. Extend src/lib/knowledge/extract.ts at the actual PDF extraction boundary with an explicitly authorized provider adapter; native text stays first. Use actual downloaded PDF bytes, preserve page markers and reject truncated or uncertain output. No silent external upload permission for future files.
2. Reuse src/lib/knowledge/actions.ts prepareStoredFile and src/lib/knowledge/prepared-publication.ts; retain source ID, object-generation fence, file/text SHA256 and content-version checks. Do not import local reviewed text as if freshly extracted.
3. Existing public g03_read_file_generation and g03_publish_prepared_file RPCs are present in database. Minimal extractor integration can be developed locally without a new production migration; real runtime publication permissions and signatures still require acceptance. Durable queue/lease or structured per-page provenance beyond embedded page markers is separate scope and may need schema changes.
4. Use existing /setup file reprocess and owner approval controls. Verify ready + approved matching version, actual loadApprovedBranchKnowledgeContext/loadApprovedAnswerContext selection, then one authorized file-exclusive answer with file source ID/page provenance. No FAQ fallback for the excluded half.
5. Preserve current concurrent edits in actions/extract/pdf-ocr and exact-generation/publication files; Graphify index fe5fed5 matches HEAD but excludes WIP.

No new provider request, migration, code integration, deployment, or trial-ledger mutation is authorized by this planning note.
