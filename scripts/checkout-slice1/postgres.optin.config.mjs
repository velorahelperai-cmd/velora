import {defineConfig} from 'vitest/config';import {resolve} from 'node:path';
export default defineConfig({resolve:{alias:{'@':resolve('src')}},test:{environment:'node',include:['scripts/checkout-slice1/postgres.optin.mjs'],fileParallelism:false,testTimeout:60000,hookTimeout:300000}});
