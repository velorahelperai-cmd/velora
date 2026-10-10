import { defineConfig } from 'vitest/config';
export default defineConfig({test:{environment:'node',include:['scripts/service-entitlement/staff-dispatch.optin.mjs'],testTimeout:60000,hookTimeout:180000,fileParallelism:false}});
