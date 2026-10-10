import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';
export default defineConfig({resolve:{alias:{'@':resolve('src')}},test:{environment:'node',include:['scripts/service-entitlement/orchestration.optin.mjs'],testTimeout:30000,hookTimeout:180000,fileParallelism:false}});
