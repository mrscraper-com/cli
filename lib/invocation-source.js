const PUBLISHED_PACKAGE_NAME = "@mrscraper/cli";

/**
 * Read an environment value case-insensitively so npm invocation metadata also
 * works on Windows.
 * @param {NodeJS.ProcessEnv} environment
 * @param {string} name
 */
function environmentValue(environment, name) {
  const exact = environment[name];
  if (typeof exact === "string" && exact.trim()) return exact.trim();

  const normalizedName = name.toUpperCase();
  for (const [key, value] of Object.entries(environment)) {
    if (
      key.toUpperCase() === normalizedName &&
      typeof value === "string" &&
      value.trim()
    ) {
      return value.trim();
    }
  }
  return undefined;
}

/** @param {NodeJS.ProcessEnv} [environment] */
export function invocationPackageSpec(environment = process.env) {
  return environmentValue(environment, "npm_config_package");
}

/** @param {string} packageSpec */
function isPublishedPackageSpec(packageSpec) {
  return (
    packageSpec === PUBLISHED_PACKAGE_NAME ||
    packageSpec.startsWith(`${PUBLISHED_PACKAGE_NAME}@`)
  );
}

/**
 * Reuse Git and local npx sources so a bootstrap launched from a branch does
 * not fall back to an unpublished registry version.
 * @param {string} version
 * @param {NodeJS.ProcessEnv} [environment]
 */
export function resolveCliPackageSpec(version, environment = process.env) {
  const override = environmentValue(
    environment,
    "MRSCRAPER_CLI_PACKAGE_SPEC",
  );
  if (override) return override;

  const invocationSource = invocationPackageSpec(environment);
  if (invocationSource && !isPublishedPackageSpec(invocationSource)) {
    return invocationSource;
  }

  return `${PUBLISHED_PACKAGE_NAME}@${version}`;
}

/** @param {string} value */
function withoutGitSuffix(value) {
  return value.endsWith(".git") ? value.slice(0, -4) : value;
}

/**
 * Convert npm's GitHub package forms into Git sources understood by the public
 * `skills` CLI. Keep the ref in the URL fragment because GitHub tree URLs
 * cannot distinguish a slash-containing branch name from a repository path.
 * @param {string} packageSpec
 */
export function skillSourceFromPackageSpec(packageSpec) {
  const githubShorthand = packageSpec.match(
    /^github:([^/#\s]+)\/([^#\s]+?)(?:#(.+))?$/,
  );
  if (githubShorthand) {
    const [, owner, rawRepository, ref] = githubShorthand;
    const repository = withoutGitSuffix(rawRepository);
    return `github:${owner}/${repository}${ref ? `#${ref}` : ""}`;
  }

  const githubUrl = packageSpec.match(
    /^(?:git\+)?https:\/\/github\.com\/([^/\s]+)\/([^#\s]+?)(?:#(.+))?$/,
  );
  if (githubUrl) {
    const [, owner, rawRepository, ref] = githubUrl;
    const repository = withoutGitSuffix(rawRepository);
    return `https://github.com/${owner}/${repository}.git${ref ? `#${ref}` : ""}`;
  }

  const githubSsh = packageSpec.match(
    /^git@github\.com:([^/\s]+)\/([^#\s]+?)(?:#(.+))?$/,
  );
  if (githubSsh) {
    const [, owner, rawRepository, ref] = githubSsh;
    const repository = withoutGitSuffix(rawRepository);
    return `git@github.com:${owner}/${repository}.git${ref ? `#${ref}` : ""}`;
  }

  if (
    packageSpec.startsWith(".") ||
    packageSpec.startsWith("/") ||
    packageSpec.startsWith("file:")
  ) {
    return packageSpec;
  }

  return undefined;
}

/**
 * @param {string} defaultSource
 * @param {NodeJS.ProcessEnv} [environment]
 */
export function resolveSkillSource(
  defaultSource,
  environment = process.env,
) {
  const override = environmentValue(environment, "MRSCRAPER_SKILL_SOURCE");
  if (override) return override;

  const packageSpec = invocationPackageSpec(environment);
  return (
    (packageSpec && skillSourceFromPackageSpec(packageSpec)) || defaultSource
  );
}
