import { assertRequiredResults } from "./safety.mjs";
assertRequiredResults(JSON.parse(process.env.CI_REQUIRED_RESULTS ?? "{}"));
console.log("All required Velora checks succeeded.");
