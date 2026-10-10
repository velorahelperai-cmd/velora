import {defineConfig} from 'vitest/config';
export default defineConfig({test:{environment:'node',include:['scripts/financial-proof-cloud/stage1.optin.mjs'],testTimeout:90000,hookTimeout:180000,fileParallelism:false}});
