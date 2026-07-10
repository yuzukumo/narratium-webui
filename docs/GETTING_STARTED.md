# Getting Started with Narratium

This guide will help you get the current maintained Narratium panel running from this repository:

<https://github.com/yuzukumo/narratium-webui>

## Prerequisites

- Node.js 20+
- pnpm (recommended) or npm
- Git

## Installation Steps

### 1. Clone the project

```bash
git clone https://github.com/yuzukumo/narratium-webui.git
cd narratium-webui
```

### 2. Install dependencies

```bash
pnpm install
```

### 3. Run the project

```bash
pnpm run dev
```

Once the development server starts, visit: [http://localhost:5000](http://localhost:5000)

## Live cache verification

Provider-side cache hits require real API credentials and repeated calls with the same long prompt prefix. The normal test suite does not call paid upstream APIs. To verify cache behavior locally, set one or more provider keys and run:

```bash
OPENAI_API_KEY=... pnpm test:cache
ANTHROPIC_API_KEY=... pnpm test:cache
GEMINI_API_KEY=... pnpm test:cache
```

The test sends two requests through the same adapters used by the app and prints cache read tokens for each provider. A successful live cache hit has a second request with cache read tokens greater than zero.

## Self-packaging

If you want to create a standalone application:

1. First, install the pake-cli globally:
```bash
npm install -g pake-cli
```

2. Then, depending on your operating system, run one of the following commands:

For Docker:
```bash
docker compose up -d
```

For macOS:
```bash
pnpm pake-mac
```

For Linux:
```bash
pnpm pake-linux
```

For Windows:
```bash
pnpm pake-win
```

### Troubleshooting

#### macOS Installation Fix

If you encounter a "damaged" display after installation on macOS, run this command in terminal:

```bash
xattr -d com.apple.quarantine /Applications/Narratium.app
```

## Next Steps

- Track issues and releases at <https://github.com/yuzukumo/narratium-webui>
- Star the current repository to stay updated with new releases
