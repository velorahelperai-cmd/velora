import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';
export default defineConfig({resolve:{alias:{'@':resolve('src')}},test:{environment:'node',include:['scripts/g03-cloud-upgrade/app-paths.optin.mjs'],testTimeout:30000,hookTimeout:120000,fileParallelism:false}});
