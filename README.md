# Narratium

![Narratium banner](./public/banner.png)

Self-hosted AI character chat and story workspace.

English | [简体中文](./README_ZH.md) | [繁體中文](./README_ZH-TW.md) | [Español](./README_ES.md) | [Français](./README_FR.md)

This repository was recreated from a local backup of an earlier fork and is now maintained by the current repository owner. The original upstream repository and contributor repositories are no longer available. The active project repository is [yuzukumo/narratium-webui](https://github.com/yuzukumo/narratium-webui).

Narratium contains application code only. It does not include character cards, stories, presets, or other user-created content.

## What It Provides

- Next.js frontend with a Go API backend and PostgreSQL storage.
- Account login with administrator and regular-user roles.
- Server-side storage for character cards, images, dialogues, presets, world books, regex scripts, and preferences.
- SillyTavern PNG, JSON, and CharX character card import, including embedded character books, regex scripts, and CharX assets.
- Administrator-managed API channels and model settings.
- OpenAI Responses, OpenAI Chat Completions, Anthropic Messages, and Gemini `generateContent` adapters.
- Streaming chat, branching dialogues, context management, prompt caching, billing, and per-user usage logs.

## Quick Start

Requirement: Docker with Compose.

```bash
export NARRATIUM_SECRET='replace-with-a-stable-random-value-of-at-least-32-characters'
docker compose up -d --build
```

Open <http://localhost:5000>. The first successfully registered account becomes the administrator. `NARRATIUM_SECRET` is required, derives the JWT and provider-key encryption keys, and must never be changed after first use.

In **Admin Panel**, create an API channel, select its protocol, enter its base URL and key, and add the original model IDs supported by that channel. Model IDs are free-form. Regular users only select models from enabled channels.

The default host port is configured directly in `docker-compose.yml`:

```yaml
ports:
  - "127.0.0.1:5000:8080"
```

`NARRATIUM_MAX_BLOB_TOTAL_GB` defaults to `2`; set it to `0` to disable the per-user total storage quota.

Back up `narratium-postgres` and keep `NARRATIUM_SECRET` in a secure password manager.

## Development

Toolchain: Node.js `24.18.0` LTS, pnpm `11.12.0`, Go `1.26.5`, and PostgreSQL `18`.

```bash
pnpm install --frozen-lockfile
```

See the [Getting Started guide](./docs/GETTING_STARTED.md) for backend and frontend startup. Run checks with:

```bash
pnpm typecheck
pnpm lint
pnpm test
pnpm test:backend:race
pnpm build
```

## License

Licensed under the [MIT License](./LICENSE). Imported or generated content remains subject to the terms of its source and creator.

## Links

- [Getting Started](./docs/GETTING_STARTED.md)
- [Issues](https://github.com/yuzukumo/narratium-webui/issues)
- [License](./LICENSE)

## Community Links

**LinuxDo** — [https://linux.do](https://linux.do/)

This community has provided support for the project.
