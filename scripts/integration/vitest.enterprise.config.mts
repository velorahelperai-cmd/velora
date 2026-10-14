import { defineConfig } from "vitest/config";
import { resolve } from "node:path";
const root=resolve(import.meta.dirname,"../..");
export default defineConfig({
 root,envDir:false,
 resolve:{alias:{"@":resolve(root,"src"),"server-only":resolve(root,"node_modules/next/dist/compiled/server-only/empty.js")}},
 test:{environment:"node",envFile:false,include:["src/**/*.test.{ts,tsx}"],maxWorkers:2,hookTimeout:60000},
});
