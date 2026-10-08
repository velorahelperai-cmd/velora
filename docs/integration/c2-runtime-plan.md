# C2 runtime and final integration plan

Runtime branch `overnight/ai-whatsapp-runtime`, fixed base `13861eb3dd20717c84517870667b77351932800c`. P3 `23bbec8` and P4 `b24064f` are already ancestors; do not repeat them. Reuse the approved local security, Meta registry/Vault, RAG, durable jobs, atomic quota/cost reservation, fencing and delivery accounting.

Add a deterministic offline consumer journey through actual webhook and worker HTTP handlers backed by the existing isolated PostgreSQL RPCs, with model/Graph transports mocked. Provide a bounded local worker verification entry point that cannot call real providers. Retain all deployment safety flags and document external launch dependencies.

After the runtime commit, create `integration/overnight-velora` from stable P1/P2 `485d21e`; integrate clean frozen Security, Runtime, Inbox UI and Onboarding UI tips in that order. Validate missing source reports through independent source inspection and executing tests on the combined branch; do not infer acceptance from commit messages. Preserve source worktrees. Adapt frontend contracts locally on integration, keeping designs and authoritative data.

Run combined unit/SQL/application/TypeScript/lint/build checks and available browser/E2E verification. Report synthetic boundaries, exact included SHAs, skipped/unavailable checks, local preview and separate Local Testing/Staging gates. No cloud SQL, real provider/payment/send, production configuration/secrets, push/deployment/backup or original branch edits.
