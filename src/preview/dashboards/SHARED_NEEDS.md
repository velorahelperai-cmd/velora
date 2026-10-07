# Shared needs (recorded — not edited in this package)

Per VEL-DASHBOARDS-UI-PREVIEW-01: do not parallel-edit shared product files. Record instead.

| Need | File (do not touch now) | Why |
| --- | --- | --- |
| Copy key «معاينة تصميم» vs existing `preview` | `src/lib/app-copy.ts` | Preview uses local `copy.ts` + `DesignPreviewBadge` instead |
| Motion utilities / reduced-motion helpers | `src/app/globals.css` | Preview uses `preview-motion.module.css` only |
| Shared dashboard section primitives | `dashboard.tsx` / `admin-list.tsx` | Previews are standalone components under `src/preview/dashboards` |
| Auth-free chrome for real `/app` | `workspace-shell.tsx` | Preview shell avoids Supabase session calls |

When wiring for real: merge carefully after purchase-gate / settlement work is stable.
