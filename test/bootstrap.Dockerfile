FROM node:22-bookworm-slim

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
  /root/.grok \
  /root/.hermes \
  /root/.opencode \
  /root/.openclaw \
  /root/.pi/agent \
  /root/.omp
RUN ln -s /bin/true /usr/local/bin/codex
RUN ln -s /bin/true /usr/local/bin/openclaw
RUN ln -s /bin/true /usr/local/bin/pi
ENV MRSCRAPER_SKILL_SOURCE=/workspace
ENV MRSCRAPER_CLI_PACKAGE_SPEC=/tmp/mrscraper-cli.tgz

# Run the checkout directly; init then globally installs the tarball above.
RUN node bin/mrscraper.js init --skip-auth --all
RUN mrscraper --version
# Cursor, Codex, OpenCode, and OMP read the universal skills directly.
RUN for skill in mrscraper mrscraper-fetch mrscraper-scrape mrscraper-serp; do \
  test -f "/root/.agents/skills/$skill/SKILL.md"; \
  done
# Claude Code, Hermes, OpenClaw, and Pi receive harness-specific links.
RUN for skill in mrscraper mrscraper-fetch mrscraper-scrape mrscraper-serp; do \
  test -f "/root/.claude/skills/$skill/SKILL.md"; \
  done
RUN for skill in mrscraper mrscraper-fetch mrscraper-scrape mrscraper-serp; do \
  test -f "/root/.hermes/skills/$skill/SKILL.md"; \
  done
RUN for skill in mrscraper mrscraper-fetch mrscraper-scrape mrscraper-serp; do \
  test -f "/root/.openclaw/skills/$skill/SKILL.md"; \
  done
RUN for skill in mrscraper mrscraper-fetch mrscraper-scrape mrscraper-serp; do \
  test -f "/root/.pi/agent/skills/$skill/SKILL.md"; \
  done
RUN mrscraper setup skills --agent claude-code
RUN mrscraper setup skills --agent hermes --dry-run
RUN mrscraper setup skills --agent openclaw --dry-run
RUN mrscraper setup skills --agent omp --dry-run
