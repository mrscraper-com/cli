import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const skillsRoot = path.join(repositoryRoot, "skills");
const skillNames = [
  "mrscraper",
  "mrscraper-fetch",
  "mrscraper-scrape",
  "mrscraper-serp",
];
const skills = Object.fromEntries(
  skillNames.map((name) => [
    name,
    fs.readFileSync(path.join(skillsRoot, name, "SKILL.md"), "utf8"),
  ]),
);
const readme = fs.readFileSync(path.join(repositoryRoot, "README.md"), "utf8");

test("repository contains exactly the four approved MrScraper skills", () => {
  const discovered = fs
    .readdirSync(skillsRoot, { withFileTypes: true })
    .filter(
      (entry) =>
        entry.isDirectory() &&
        fs.existsSync(path.join(skillsRoot, entry.name, "SKILL.md")),
    )
    .map(({ name }) => name)
    .sort();

  assert.deepEqual(discovered, [...skillNames].sort());
});

test("every skill has complete, normalized, harness-neutral metadata", () => {
  for (const [name, skill] of Object.entries(skills)) {
    const frontmatter = skill.match(/^---\n([\s\S]*?)\n---/);
    assert.ok(frontmatter, `${name} must start with YAML frontmatter`);
    assert.match(frontmatter[1], new RegExp(`^name: ${name}$`, "m"));
    const description = frontmatter[1].match(/^description: (.+)$/m)?.[1];
    assert.ok(description, `${name} must have a single-line description`);
    assert.equal(
      description,
      description.normalize("NFKC").trim().replace(/\s+/gu, " "),
      `${name} description must already be normalized`,
    );
    assert.doesNotMatch(frontmatter[1], /^(?!name:|description:|\s).+:/m);
    assert.doesNotMatch(skill, /\bTODO\b/);
    assert.doesNotMatch(
      skill,
      /^\s*(?:[-*]|\d+\.) [a-z]/m,
      `${name} list items must begin with a capital letter`,
    );
    assert.ok(skill.split("\n").length < 500, `${name} must stay concise`);
    assert.equal(
      fs.existsSync(path.join(skillsRoot, name, "agents", "openai.yaml")),
      false,
    );
  }
});

test("router owns onboarding and routes detailed web work to focused skills", () => {
  const router = skills.mrscraper;

  assert.match(
    router,
    /npx -y @mrscraper\/cli@latest init --all --yes --skip-auth/,
  );
  assert.match(router, /`--yes` keeps bootstrap non-interactive/);
  assert.match(router, /`--skip-auth` leaves login for the next step/);
  assert.match(router, /\| Hermes Agent \| `hermes` \|/);
  assert.match(router, /\| OpenClaw \| `openclaw` \|/);
  assert.match(router, /`npx -y` approves npm package execution/);
  assert.match(router, /Keep the command running while the user approves/);
  assert.match(router, /CI, containers, or headless automation/);
  assert.match(router, /mrscraper setup skills/);
  assert.match(router, /MCP is available separately/);
  assert.match(router, /uses bearer API-key configuration/);
  assert.doesNotMatch(router, /mrscraper setup mcp|--local-mcp|--mcp-url/);
  assert.match(router, /\.\.\/mrscraper-fetch\/SKILL\.md/);
  assert.match(router, /\.\.\/mrscraper-scrape\/SKILL\.md/);
  assert.match(router, /\.\.\/mrscraper-serp\/SKILL\.md/);
  assert.match(router, /^## Step 4 — Handle Output and Artifacts$/m);
  assert.match(router, /mrscraper fetch "https:\/\/example\.com\/page"/);
  assert.match(router, /mrscraper scrape "https:\/\/example\.com\/listing"/);
  assert.match(router, /mrscraper serp "example search query"/);
  assert.match(router, /Save substantial artifacts under the current project's `\.\/\.mrscraper\/`/);
  assert.match(router, /project artifact folder `\.\/\.mrscraper\/` is separate from the credential/);
  assert.match(router, /^## Step 5 — Rerun Saved Scrapers$/m);
  assert.match(router, /^## Step 6 — Inspect Stored Results$/m);
  assert.match(router, /^## Step 7 — Review Account Usage$/m);
  assert.match(router, /^## Limits$/m);
  for (const option of [
    "--max-depth",
    "--max-pages",
    "--limit",
    "--sort-field",
    "--sort-order",
    "--page-size",
    "--date-range-column",
    "--domain",
    "--from",
    "--to",
    "--api-token-name",
  ]) {
    assert.match(router, new RegExp(option));
  }
  assert.doesNotMatch(router, /--unblock|--schema\b/);
  assert.doesNotMatch(router, /\bPath [A-F]\b|^## Get Credentials$/m);
});

test("focused skills have distinct commands and intent boundaries", () => {
  assert.match(skills["mrscraper-fetch"], /mrscraper fetch/);
  assert.match(skills["mrscraper-fetch"], /--browser-rendering/);
  assert.match(skills["mrscraper-fetch"], /GET https:\/\/api\.mrscraper\.com\//);
  assert.match(skills["mrscraper-fetch"], /runtime and bandwidth/);
  assert.match(skills["mrscraper-fetch"], /initial request always runs/);
  for (const option of [
    "--geo-code",
    "--wait-for-selector",
    "--home-page",
    "--block-resources",
    "--max-retries",
    "--token-cap",
    "--timeout",
  ]) {
    assert.match(skills["mrscraper-fetch"], new RegExp(option));
  }
  assert.doesNotMatch(
    skills["mrscraper-fetch"],
    /mrscraper fetch[^\n]*(?:--format|--unblock)/,
  );
  assert.match(skills["mrscraper-fetch"], /^## Access Boundary$/m);
  assert.match(skills["mrscraper-fetch"], /only for public pages/);
  assert.match(skills["mrscraper-fetch"], /stop when content requires authorization/);
  assert.doesNotMatch(skills["mrscraper-fetch"], /unblocker|protected pages|geo-sensitive/i);
  assert.match(skills["mrscraper-fetch"], /read, summarize, cite/);
  assert.match(skills["mrscraper-fetch"], /^## Step 5 — Deliver the Result$/m);

  assert.match(skills["mrscraper-scrape"], /mrscraper scrape/);
  assert.match(skills["mrscraper-scrape"], /POST https:\/\/api\.app\.mrscraper\.com\/api\/v1\/scrapers-ai/);
  assert.match(skills["mrscraper-scrape"], /--prompt/);
  assert.match(skills["mrscraper-scrape"], /--schema-prompt/);
  assert.match(skills["mrscraper-scrape"], /strict schema compliance/);
  assert.match(skills["mrscraper-scrape"], /For map, omit `--prompt`/);
  assert.match(skills["mrscraper-scrape"], /--output/);
  for (const option of [
    "--proxy-country",
    "--max-pages",
    "--max-depth",
    "--limit",
    "--include-patterns",
    "--exclude-patterns",
  ]) {
    assert.match(skills["mrscraper-scrape"], new RegExp(option));
  }
  assert.match(skills["mrscraper-scrape"], /defined fields|fields or records/);
  assert.match(
    skills["mrscraper-scrape"],
    /Treat a successfully written output file as the extraction artifact/,
  );
  assert.match(
    skills["mrscraper-scrape"],
    /\| `general` \| One detail page or one extraction task/,
  );
  assert.match(skills["mrscraper-scrape"], /Post-process only when/);
  assert.match(
    skills["mrscraper-scrape"],
    /can take\s+several minutes/,
  );
  assert.match(skills["mrscraper-scrape"], /Listing still running\.\.\./);
  assert.match(skills["mrscraper-scrape"], /submit a duplicate/);

  assert.match(skills["mrscraper-serp"], /mrscraper serp/);
  assert.match(skills["mrscraper-serp"], /POST https:\/\/sync\.scraper\.mrscraper\.com\/api\/google\/serp\/v2\/sync/);
  assert.match(skills["mrscraper-serp"], /--region/);
  assert.match(skills["mrscraper-serp"], /has no target URL/);
  for (const option of [
    "--language",
    "--page",
    "--format",
    "--render-js",
    "--raw",
    "--client-timeout",
  ]) {
    assert.match(skills["mrscraper-serp"], new RegExp(option));
  }
  assert.match(skills["mrscraper-serp"], /^## Step 5 — Continue with Relevant URLs$/m);
});

test("README and skills use direct product language", () => {
  const documentation = [readme, ...Object.values(skills)].join("\n");
  for (const phrase of [
    /\breal (?:API|backend)/i,
    /\bfake (?:API|backend)/i,
    /\btruthful\b/i,
    /\bhonestly\b/i,
    /no hidden default/i,
    /silently (?:drop|discard|ignore)/i,
    /does not convert HTML/i,
    /construct (?:a )?page-document JSON/i,
    /previous automatic/i,
  ]) {
    assert.doesNotMatch(documentation, phrase);
  }
});

test("README connects fetch to the Web Unblocker documentation", () => {
  assert.match(readme, /docs\.mrscraper\.com\/docs\/features\/unblocker/);
  assert.match(readme, /one plan token per 30 seconds/);
  assert.match(readme, /one plan token per 0\.2 MB/);
});

test("skill pack documents only supported CLI command names", () => {
  const supportedCommands = new Set([
    "--version",
    "auth",
    "fetch",
    "init",
    "login",
    "logout",
    "rerun",
    "result",
    "results",
    "scrape",
    "serp",
    "setup",
    "status",
  ]);
  const documentedCommands = Object.values(skills).flatMap((skill) =>
    [...skill.matchAll(/^mrscraper\s+([^\s]+)/gm)].map((match) => match[1]),
  );

  assert.ok(documentedCommands.length > 0);
  assert.deepEqual(
    [
      ...new Set(
        documentedCommands.filter((name) => !supportedCommands.has(name)),
      ),
    ],
    [],
  );
  for (const command of [
    "fetch",
    "scrape",
    "serp",
    "rerun",
    "results",
    "result",
    "status",
  ]) {
    assert.ok(documentedCommands.includes(command), `missing ${command} example`);
  }
});

test("skills remain repository-hosted rather than npm-bundled", () => {
  const packageJson = JSON.parse(
    fs.readFileSync(path.join(repositoryRoot, "package.json"), "utf8"),
  );

  assert.equal(packageJson.files.includes("skills"), false);
});
