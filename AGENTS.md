# Velora shared execution entrypoint

## Owner decision 2026-10-29 — delivery transition IN PROGRESS

The owner removed guard.mjs and writer.mjs and directs removal of mandatory Consolidation, file-lease, and custom pre-push dependencies. Do not recreate them. Retain independent CI, secrets, RLS and security checks; inspect Git status and scoped diffs and preserve other work. Older instructions requiring those tools and leases are superseded. Implementation and verification are pending; do not claim delivery readiness or bypass any current security gate.

Local debugging (owner request 2026-10-26): use [the on-demand troubleshooting entrypoint](docs/TROUBLESHOOTING.md), search prior signatures before diagnosis, then run only affected checks. Graphify is needed for dependency/impact questions, with freshness verified. Keep mandatory product security checks and preserve other agents’ work. This scoped instruction adds no background service or publication authority.

## PROJECT-BRAIN-READ-FIRST

The owner-approved sole Project Brain is [Velora / 00-INDEX](<C:/Users/DELL/Desktop/Obsidian/AI Workspace/Velora/00-INDEX.md>). Read the approved task, sequence and applicable rules there before every task. [Project rules](<C:/Users/DELL/Desktop/Obsidian/AI Workspace/Velora/10-PROJECT-RULES.md>), [decisions](<C:/Users/DELL/Desktop/Obsidian/AI Workspace/Velora/01-DECISIONS.md>), [acceptance](<C:/Users/DELL/Desktop/Obsidian/AI Workspace/Velora/02-ACCEPTANCE.md>) and [error knowledge / LOG-001](<C:/Users/DELL/Desktop/Obsidian/AI Workspace/Velora/08-LESSONS.md>) are active there. Follow the current Engineering Constitution links from the Brain; do not copy that constitution here.

1. Prove actual Brain access in the current agent/environment. If unavailable or an approved decision conflicts, block the affected task, record the exact missing access/decision and do not substitute an old plan. Codex access does not prove Cursor or Antigravity access. Claude is currently unused (N/A), not a closure requirement.
2. **GRAPHIFY-FIRST:** after Brain, use Graphify as the primary and mandatory starting point for technical discovery and analysis: identify target files, dependencies, impact and related tests. Verify repository, indexed commit and date against Git HEAD. Do not browse the project or history in bulk or at random. Read only the relevant current code sections and necessary instructions/safeguards to verify and implement the scoped task. If the index is unavailable, stale or of unknown freshness, record the specific blocker; do not automatically substitute a broad filesystem scan. Graphify is not a source of approved decisions or a replacement for current-code verification.
3. Inspect current code and GitHub evidence. Read only the first Current Session Index of [PROJECT_STATE.md](PROJECT_STATE.md), and coordination notes relevant to the paths you will touch, for writers/evidence/blockers. Do not reread the entire history before each task.
4. Consult only a historical section explicitly marked unmapped in the Brain source register or required by an authorized scoped review. Matched MASTER_PLAN/decision/error files remain evidence, never a second active plan; do not reread their full history.
5. Treat STRUCTURAL, MAPPED, SPEC_READY and RUNTIME_VERIFIED as distinct. Follow task-specific acceptance and the review dispositions in [Brain coverage](<C:/Users/DELL/Desktop/Obsidian/AI Workspace/Velora/06-COVERAGE.md#review-findings>); a count or migration checklist is not product acceptance. Historical proposals never become approved architecture, policy or performance limits merely by being mapped.
6. Execute only the authorized task in its approved sequence with applicable security, logging and tests. After proven success update its Brain task with commit/test evidence and the concise execution index. Checkbox completion alone is not DONE. Record the outcome and any needed handoff. Preserve other agents’ changes, use normal Git delivery within owner authorization, and verify CI and hosted results.

## Technical safeguards

Canonical repository root: `C:\Users\DELL\Desktop\Velora new`; origin `velorahelperai-cmd/velora`; allowed GitHub account `velorahelperai-cmd`. Use `GIT_OPTIONAL_LOCKS=0` for read-only Git inspection.

### Shared checkout and delivery

Work in the canonical checkout on main. Review affected files and preserve other agents’ changes. Stage only the authorized package. Do not use force push, reset or clean to discard work. Use normal Git delivery within the owner's authorization, keep product security checks, and verify CI and the deployed SHA.

Current MASTER-PLAN-001 documentation limits remain: no unauthorized feature/SQL/provider/env changes under a docs-only charter. Owner-authorized product tasks follow their own Brain scope.

For handoff, record actual progress, affected files, Git state, verification and remaining blockers; preserve other work.

قاعدة التنفيذ والاختبار داخل المسار الحقيقي
- نفّذ التعديلات داخل رحلة العميل الأصلية، بنفس الصفحات والمكونات والخدمات وترتيب الخطوات. لا تنشئ صفحة أو رحلة اختبار موازية تحتاج دمجًا لاحقًا.
- اعزل بيانات وصلاحيات الاختبار، لا تجربة المستخدم: استخدم حسابًا ورقمًا محددين وبوابة خادمية محدودة، مع توضيح وضع الاختبار ومنع آثاره التجارية غير المقصودة.
- أعد استخدام الكود الموجود. لا تنسخ منطق الحفظ أو الدفع أو الربط أو AI لتكوين نسخة تجريبية.
- ابدأ بأصغر تعديل يحل السبب المثبت، ثم اختبر السلوك المتأثر والحمايات المرتبطة به. لا تعِد الاختبارات الواسعة على نفس المدخلات دون تغيير مؤثر أو اشتراط من بوابات المشروع.
- حافظ على فحوص الأمان وبوابات النشر الإلزامية. تقليل الوقت يكون بإزالة التكرار، وليس تعطيل الحماية.
- إذا كان المسار المنفصل ضروريًا فعلًا، وضّح السبب ولماذا لا تكفي بوابة داخل المسار الحالي، واطلب موافقتي قبل بنائه.
- لا تعتبر نجاح الاختبارات نجاحًا لرحلة العميل؛ أثبت الخطوات الفعلية، واذكر ما لم يُختبر بوضوح.

<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
