// No bootstrap, cloud access, or model execution. Uses the labelled C1 database only.
import { readFileSync } from "node:fs";
import { verify, session } from "../whatsapp-integration/postgres.mjs";

await verify();
const test = readFileSync(new URL("./ai-security.sql", import.meta.url), "utf8");
const run = session(test, "c1_ai_security");
run.child.stdout.on("data", chunk => process.stdout.write(chunk));
try {
  await run.done;
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
