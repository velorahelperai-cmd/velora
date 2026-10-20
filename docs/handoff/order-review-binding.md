# Order Review binding spec (for Codex) — not applied

Standalone, unmounted files: `src/components/app/setup-order-review.tsx`, `setup-order-review-model.ts`, `setup-order-review.module.css`, tests `setup-order-review.test.tsx`, `setup-order-review-lifecycle.test.ts`, `setup-order-review-wrapper.test.tsx`.
Journey (`setup-plan-journey.ts`), `prepayment-preparation.tsx`, provider, catalog, global CSS and live public assets were NOT touched.

## Mount point
Render when `snapshot.step === "localReview"` inside the Studio shell of `PrepaymentPreparation`, replacing the plans view for that step.

```tsx
const s = snapshot; // SetupPlanJourneySnapshot, refreshed by host after every journey call
<SetupOrderReview
  ar={ar}
  slots={s.slots}
  term={s.term}
  write={s.write}
  editingLocked={s.editingLocked}
  actor={{ accountId: s.accountId, captureToken: s.captureToken }}
  consentAccepted={s.consentAccepted}   // controlled
  onConsentChange={(v) => { journey.setConsent(v); refresh(); }}
  confirmReview={async (c) => { const r = await journey.confirmReview(c); refresh(); return r; }}
  retrySameOperation={async () => { const r = await journey.confirmReview(true); refresh(); return r; }} // same clientOpId/frozen selection
  onConfirmed={(r) => { /* r.order.specialReference, r.settlement==="UNPAID", r.serviceReady===false */ }}
  onEditBranch={() => { journey.openPlans(); setStep("plans"); refresh(); }}
  onBackToPlans={() => { journey.openPlans(); setStep("plans"); refresh(); }}
  termsHref="/terms"
  motionEnabled   // optional, default true
/>
```

## Changes in this revision
- **Props**: one new optional prop `motionEnabled?: boolean` (default true). No other prop changed. `ViewProps` gained optional `outcomeUnknown?` and `motionEnabled?`.
- **Live fences**: every handler (confirm, retry, edit, back, consent) and every post-`await` step reads a live cell (`createLiveCell`, synced synchronously during render; `mounted` flipped by effects) through `createReviewController` (model file). Before the bound callback fires and after the await, the controller checks `mounted && liveKey === startKey`. A retained handler from account A, a result arriving after A->B (even before effects ran) and a result after unmount: no state update, no `onConfirmed`, no retry callback. The host callback is still not cancelled once it started (cannot be); only its result is dropped.
- **Truthful copy**: `STALE_CAPTURE` after start, `UNKNOWN`, and thrown calls are outcome `UNKNOWN` (internal `outcome:"UNKNOWN"`, `outcomeUnknown` on the view). The component never creates or exposes an operation id: it reports `result.clientOpId`, else the host's current `write.clientOpId`, else `null`. Copy (AR+EN) says the outcome was not confirmed and the order may exist; it does not say "nothing was sent" and does not promise that reloading recovers OPEN/UNKNOWN. For `STALE_CAPTURE` the phase stays `"failed"` (session class blocks confirm), to match Codex's independent probe (`phase === "failed"`), while `outcomeUnknown` is true. `"unknown"` phase (retry same operation) is used for `UNKNOWN`.
- **Amounts**: when an order exists (`local created` result or `write.kind === "unpaid"`), rows, total, term and branch count come from `order.offer` (`Es02ImmutableOffer`: `term`, `amountBaisa`, `branchSlots`, `slots[].slotIndex/persona/package/amountBaisa`). The catalog is used only for replies/seats/channels display. Before an order exists the catalog preview is shown and labelled (`data-role="price-source" data-source="preview"`, text: preview, amounts confirmed when the order is created). With an order: `data-source="order"`. A display total is never a quote authority and payload/op id are untouched.
- **Motion**: static poster by default. A `<video>` is mounted only while `enabled && IntersectionObserver supported && matchMedia supported && !prefers-reduced-motion && figure intersects (>=25%) && page visible && no error`; it is unmounted/unloaded (`pause`, remove `src`, `load()`) when any condition ends. Poster is the fallback on error / autoplay rejection. `muted`, `playsInline`, `loop`, no `controls`, `aria-hidden`, `object-fit: contain` inside a 692:388 box (no extra crop). Logic lives in `createMotionController` (injectable env, unit-tested without DOM). No claim of transparency.

## Assets used (all pre-existing, no new binaries, none modified)
| Persona | Poster | Motion |
|---|---|---|
| level_1 Noura | `/media/setup/noura-studio-poster.png` | `/media/setup/noura-studio.mp4` |
| level_2 Lina | `/media/setup/lina-team-poster.png` | `/media/setup/lina-team.mp4` |
| level_3 Dana | `/media/setup/dana-team-poster.png` | `/media/setup/employee-introduction.mp4` (mapping per Codex's fix request) |

Not used: all GIFs (4–12 MB), including `gemini_generated_video_e25570a9.gif` (rejected) and the newer `docs/New folder` portrait GIFs (`dana-explaining`, `lina-explaining`, `character-*-explaining`, `team-office-animated`): too large, opaque background, identity/mapping pending. Gap: no approved compressed mp4/webm exists for them. Conversion (needs ffmpeg, not installed by this task; run by an owner who has it):
`ffmpeg -i in.gif -an -c:v libx264 -pix_fmt yuv420p -crf 28 -movflags +faststart -vf "scale=692:-2:flags=lanczos" out.mp4` and optionally `ffmpeg -i in.gif -an -c:v libvpx-vp9 -b:v 0 -crf 36 -vf "scale=692:-2" out.webm`, plus a first-frame PNG poster (`-frames:v 1 poster.png`). Target well under 1.5 MB each; then map identity explicitly in `PERSONA_VIDEOS`/`PERSONA_POSTERS`.
mp4 pixel dimensions were not verified here (no ffprobe); the figure box is 692:388 with `contain`.

## Remaining gaps
1. No reconciliation API in the journey: UNKNOWN recovery = same `confirmReview(true)`. Browser-loss recovery remains the documented memory-only gap.
2. No step value for "created"; host decides after `write.kind === "unpaid"`.
3. `Es02AccountOrderView` exposes `specialReference`, shown as the server reference.
4. Persona spelling: component uses Dana «دانا» (per Codex); `subscription-copy.ts` spells «دانة».
5. Real browser (Chrome) RTL/LTR 320/390/768/1440 and motion visual acceptance: NOT RUN.

## Codex follow-up: shared motion capacity
The live review figures share createMotionBudget(2). At most two eligible figures mount video; remaining branches keep static posters. Offscreen, hidden/reduced, errors and unmount release permits; waiting/disposed figures cannot claim later permits. Two independent capacity tests cover32visible figures and waiting cancellation;59/59 current Node cases PASS. Chrome/many-branch decode verification and Studio binding remain pending. No media binaries or backend contracts changed.
