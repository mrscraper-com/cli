import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const VERSION = JSON.parse(
  readFileSync(path.join(__dirname, "..", "package.json"), "utf8"),
).version;
