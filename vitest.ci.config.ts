import { configDefaults, defineConfig } from "vitest/config";
import base from "./vitest.config";

// Native SQL/HTTP acceptance remains available through its explicit opt-in
// configurations. CI unit acceptance never starts Docker, a browser or a DB.
export default defineConfig({
  ...base,
  envDir: false,
  test: {
    ...base.test,
    exclude: [
      ...configDefaults.exclude,
      "src/**/*postgres*.test.*",
      "src/**/*local-sql.test.*",
      "src/**/live-offer-sql.test.*",
    ],
  },
});
