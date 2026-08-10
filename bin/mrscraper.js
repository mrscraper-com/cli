#!/usr/bin/env node
import { runCli } from "../lib/cli.js";

runCli().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});
