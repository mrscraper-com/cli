// Run one operation from this checkout against the API, using an exported token.
import fs from "node:fs/promises";
import path from "node:path";
import { scraperMarkdown, webSearch, account } from "../lib/index.js";

const help = `Usage:
  export MRSCRAPER_API_TOKEN="YOUR_API_TOKEN"
  node scripts/manual-real.mjs account
  node scripts/manual-real.mjs scraperMarkdown [url]
  node scripts/manual-real.mjs webSearch ["query or Google search URL"]

MRSCRAPER_API_KEY is also supported and takes precedence over MRSCRAPER_API_TOKEN.
scraperMarkdown defaults to https://books.toscrape.com/ and requests Markdown.
webSearch defaults to "books to scrape" and requests parsed JSON.
Each invocation makes one API call. Page and search requests can use API quota.
Results are printed as JSON and saved to .mrscraper/manual/<operation>.json.
The next run of the same operation replaces its previous result.
`;

async function main() {
  const [operation, input, ...extra] = process.argv.slice(2);
  if (!operation || operation === "--help" || operation === "-h") {
    console.log(help);
    return;
  }
  if (!["scraperMarkdown", "webSearch", "account"].includes(operation)) {
    throw new Error("Choose one operation: scraperMarkdown, webSearch, or account. Use --help for examples.");
  }
  if (extra.length || (operation === "account" && input !== undefined)) {
    throw new Error("Unexpected arguments. Quote search queries containing spaces. Use --help for examples.");
  }

  const token = process.env.MRSCRAPER_API_KEY?.trim() || process.env.MRSCRAPER_API_TOKEN?.trim();
  if (!token) {
    throw new Error("Export MRSCRAPER_API_TOKEN or MRSCRAPER_API_KEY before running an operation.");
  }

  console.error(`Running ${operation}…`);
  let result;
  if (operation === "scraperMarkdown") {
    result = await scraperMarkdown({ token, url: input ?? "https://books.toscrape.com/" });
  } else if (operation === "webSearch") {
    result = await webSearch({ token, query: input ?? "books to scrape", raw: false, format: "json" });
  } else {
    result = await account({ token });
  }

  const json = `${JSON.stringify(result, null, 2)}\n`;
  process.stdout.write(json);
  const directory = path.resolve(".mrscraper", "manual");
  await fs.mkdir(directory, { recursive: true, mode: 0o700 });
  const file = path.join(directory, `${operation}.json`);
  await fs.writeFile(file, json, { mode: 0o600 });
  console.error(`Saved response to ${file}`);

  if (result.error || !(result.status_code >= 200 && result.status_code < 300)) {
    console.error(`${operation} failed: ${result.error || `HTTP ${result.status_code}`}`);
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
