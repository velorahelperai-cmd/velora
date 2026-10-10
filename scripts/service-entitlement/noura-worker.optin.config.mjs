import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';
export default defineConfig({resolve:{alias:{'@':resolve('src')}},test:{environment:'node',include:['scripts/service-entitlement/noura-worker.optin.mjs'],testTimeout:60000,hookTimeout:180000,fileParallelism:false}});
