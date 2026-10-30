// Exercise the installed package using the same mock-backed workflow as CI.
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { SUPPORTED_HARNESSES } from "../lib/skills-installer.js";

const harness = process.argv[2];
if (!SUPPORTED_HARNESSES.includes(harness)) {
  throw new Error(`Expected a supported harness: ${SUPPORTED_HARNESSES.join(", ")}`);
}
execFileSync(process.execPath, ["--test", fileURLToPath(new URL("../test/e2e.test.js", import.meta.url))], {
  stdio: "inherit",
  env: { ...process.env, MRSCRAPER_E2E_EXECUTABLE: "mrscraper", MRSCRAPER_E2E_HARNESS: harness },
});
