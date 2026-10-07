# Dashboard UI preview (VEL-DASHBOARDS-UI-PREVIEW-01)

Isolated design previews. **Not** wired to Supabase, Paymob, or production dashboards.

## Open locally

```bash
npm run dev
```

- Index: http://localhost:3000/preview/dashboards
- Customer: http://localhost:3000/preview/dashboards/client
- Admin: http://localhost:3000/preview/dashboards/admin

## Boundaries

- Fixtures live only under `src/preview/dashboards/fixtures/`
- Marked «معاينة تصميم» / Design preview
- Does not import or mutate `dashboard.tsx`, `admin-list.tsx`, `app-copy.ts`, `globals.css`, payment, or ACCESS routes
- Buttons show destination or illustrative note — no fake save/payment success

See `SOURCE_MAP.md` and `SHARED_NEEDS.md`.
