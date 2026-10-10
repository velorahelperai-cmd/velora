import {defineConfig} from 'vitest/config';
import {resolve} from 'node:path';
export default defineConfig({resolve:{alias:{'@':resolve('src')}},test:{include:['scripts/admin-billing-ledger/postgres.optin.mjs'],environment:'node',testTimeout:60000,hookTimeout:240000,fileParallelism:false}});
