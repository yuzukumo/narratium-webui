# Narratium

AI character roleplay panel and local-first story workspace.

![Narratium banner](./public/banner.png)

This repository is the current maintained continuation of a Narratium panel codebase restored from a local backup of an earlier fork. The original upstream repository, historical contributor graph, community links, and several old project resources are no longer available to the current maintainer, so future maintenance, releases, and issue tracking will happen here.

Current repository: [https://github.com/yuzukumo/narratium-webui](https://github.com/yuzukumo/narratium-webui)

[![GitHub stars](https://img.shields.io/github/stars/yuzukumo/narratium-webui?style=social)](https://github.com/yuzukumo/narratium-webui)
[![GitHub forks](https://img.shields.io/github/forks/yuzukumo/narratium-webui?style=social)](https://github.com/yuzukumo/narratium-webui/forks)
[![Last commit](https://img.shields.io/github/last-commit/yuzukumo/narratium-webui)](https://github.com/yuzukumo/narratium-webui/commits/main)
[![License](https://img.shields.io/github/license/yuzukumo/narratium-webui)](./LICENSE)

[Chinese README](./README_ZH.md) | [Getting Started](./docs/GETTING_STARTED.md) | [Issues](https://github.com/yuzukumo/narratium-webui/issues) | [Releases](https://github.com/yuzukumo/narratium-webui/releases)

## What This Is

Narratium is a self-hostable web panel for AI character chat, branching conversations, prompt presets, world books, and regex-based text processing. It is designed to run locally or in a small private deployment, with user data handled in the browser/local environment rather than through a hosted service.

This repository contains the panel and service source code only. It does not bundle character cards, story content, user-generated content, or community-contributed content assets.

## Features

- AI character chat workspace with long-form conversation flows.
- SillyTavern-compatible PNG character card import.
- Visual dialogue tree for tracing and switching conversation branches.
- Prompt preset, world book, regex script, and advanced settings editors.
- OpenAI, Anthropic, Gemini, and compatible API endpoint configuration.
- Local import/export utilities for user data.
- Docker Compose deployment and Pake packaging scripts.

## Quick Start

### Docker Compose

```bash
docker compose up -d
```

Then open [http://localhost:5000](http://localhost:5000).

The compose file uses the current image name:

```yaml
ghcr.io/yuzukumo/narratium-webui:latest
```

### From Source

Recommended prerequisites:

- Node.js 20+
- pnpm
- Git

```bash
git clone https://github.com/yuzukumo/narratium-webui.git
cd narratium-webui
pnpm install
pnpm dev
```

Then open [http://localhost:5000](http://localhost:5000).

Useful scripts:

```bash
pnpm build
pnpm lint
pnpm test
```

## License

This repository is licensed under the MIT License. See [LICENSE](./LICENSE).

User-imported or user-generated content is outside the scope of this repository and is governed by its own source, creator, or platform terms.
