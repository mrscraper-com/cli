FROM node:20-bookworm-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates git \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /workspace

COPY package.json package-lock.json ./
RUN npm ci

COPY . .

# Validate the checkout and pack the exact branch package. Nothing is installed
# on the host running this Docker build.
RUN npm test
RUN npm pack --pack-destination /tmp \
  && mv /tmp/mrscraper-cli-*.tgz /tmp/mrscraper-cli.tgz

# Simulate machines with the supported harness layouts discussed in the
# onboarding flow. Point the installer at this checkout so the smoke test
# exercises the unmerged skill instead of GitHub's main branch.
RUN mkdir -p \
  /root/.claude \
  /root/.codex \
  /root/.cursor \
  /root/.opencode \
  /root/.pi/agent \
  /root/.omp
ENV MRSCRAPER_SKILL_SOURCE=/workspace
ENV MRSCRAPER_CLI_PACKAGE_SPEC=/tmp/mrscraper-cli.tgz

# Run the checkout directly; init then globally installs the tarball above.
RUN node bin/mrscraper.js init --skip-auth --all
RUN mrscraper --version
# Cursor, Codex, OpenCode, and OMP read the universal skill directly.
RUN test -f /root/.agents/skills/mrscraper/SKILL.md
# Claude Code and Pi receive harness-specific links to that universal skill.
RUN test -f /root/.claude/skills/mrscraper/SKILL.md
RUN test -f /root/.pi/agent/skills/mrscraper/SKILL.md
RUN mrscraper setup skills --agent claude-code
RUN mrscraper setup skills --agent omp --dry-run
