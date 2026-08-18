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

test("every skill has complete, minimal, harness-neutral metadata", () => {
  for (const [name, skill] of Object.entries(skills)) {
    const frontmatter = skill.match(/^---\n([\s\S]*?)\n---/);
    assert.ok(frontmatter, `${name} must start with YAML frontmatter`);
    assert.match(frontmatter[1], new RegExp(`^name: ${name}$`, "m"));
    assert.match(frontmatter[1], /^description: \|$/m);
    assert.doesNotMatch(frontmatter[1], /^(?!name:|description:|\s).+:/m);
    assert.doesNotMatch(skill, /\bTODO\b/);
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
  assert.match(router, /Always include both `--yes` and `--skip-auth`/);
  assert.match(router, /--agent hermes --yes --skip-auth/);
  assert.match(router, /--agent openclaw --yes --skip-auth/);
  assert.match(router, /package execution only; it\s+does not authenticate the CLI/);
  assert.match(router, /run `mrscraper login` and tell the human to approve/);
  assert.match(router, /headless, remote, or unattended session, do not launch/);
  assert.match(router, /mrscraper setup skills/);
  assert.match(router, /also offers MCP/);
  assert.match(router, /not installed by this bootstrap/);
  assert.match(router, /separately with a bearer API key/);
  assert.doesNotMatch(router, /mrscraper setup mcp|--local-mcp|--mcp-url/);
  assert.match(router, /\.\.\/mrscraper-fetch\/SKILL\.md/);
  assert.match(router, /\.\.\/mrscraper-scrape\/SKILL\.md/);
  assert.match(router, /\.\.\/mrscraper-serp\/SKILL\.md/);
  assert.match(router, /^## Run Core Web Commands$/m);
  assert.match(router, /mrscraper fetch "https:\/\/example\.com\/page"/);
  assert.match(router, /mrscraper scrape "https:\/\/example\.com\/listing"/);
  assert.match(router, /mrscraper serp "example search query"/);
  assert.match(router, /Save artifacts under\s+`\.\/\.mrscraper\/`/);
  assert.match(router, /project folder is unrelated to `~\/\.mrscraper\/auth\.json`/);
  assert.match(router, /^## Rerun and Inspect Saved Work$/m);
  assert.match(router, /^## Review Usage and Domain Outcomes$/m);
  assert.match(router, /^## Know the Limits$/m);
  assert.doesNotMatch(router, /--unblock|--schema|--region/);
  assert.doesNotMatch(router, /\bPath [A-F]\b|^## Get Credentials$/m);
});

test("focused skills have distinct commands and intent boundaries", () => {
  assert.match(skills["mrscraper-fetch"], /mrscraper fetch/);
  assert.match(skills["mrscraper-fetch"], /--unblock always/);
  assert.match(skills["mrscraper-fetch"], /read, summarize, cite/);

  assert.match(skills["mrscraper-scrape"], /mrscraper scrape/);
  assert.match(skills["mrscraper-scrape"], /--prompt/);
  assert.match(skills["mrscraper-scrape"], /--schema/);
  assert.match(skills["mrscraper-scrape"], /--output/);
  assert.match(skills["mrscraper-scrape"], /defined fields|requested fields/);
  assert.match(
    skills["mrscraper-scrape"],
    /Treat a successfully written file as the finished artifact/,
  );
  assert.match(
    skills["mrscraper-scrape"],
    /single property, product,\nvehicle, or job listing detail page uses the default `general` agent/,
  );
  assert.match(skills["mrscraper-scrape"], /Post-process only when/);
  assert.match(
    skills["mrscraper-scrape"],
    /one-page listing took about 150 seconds/,
  );
  assert.match(skills["mrscraper-scrape"], /Listing still running\.\.\./);
  assert.match(skills["mrscraper-scrape"], /submitting a duplicate/);

  assert.match(skills["mrscraper-serp"], /mrscraper serp/);
  assert.match(skills["mrscraper-serp"], /--region/);
  assert.match(skills["mrscraper-serp"], /no known target URL/);
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
