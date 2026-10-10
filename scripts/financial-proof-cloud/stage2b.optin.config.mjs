import {defineConfig} from 'vitest/config';
import {resolve} from 'node:path';
export default defineConfig({resolve:{alias:{'@':resolve('src')}},test:{environment:'node',include:['scripts/financial-proof-cloud/stage2b-financial.optin.mjs','scripts/financial-proof-cloud/stage2b-component.optin.mjs','scripts/financial-proof-cloud/stage2b.optin.mjs'],testTimeout:120000,hookTimeout:300000,fileParallelism:false}});
