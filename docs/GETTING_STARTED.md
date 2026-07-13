# Getting Started

The maintained repository is <https://github.com/yuzukumo/narratium-webui>.

## Docker Compose

Set one stable master secret before starting the stack:

```bash
export NARRATIUM_SECRET='replace-with-a-stable-random-value-of-at-least-32-characters'
docker compose up -d --build
```

Open <http://localhost:5000>. The first successfully registered account becomes the administrator; no bootstrap token is required.

The stack contains the Go API server, its statically built Next.js frontend, and `postgres:18-alpine`. The API applies versioned PostgreSQL migrations automatically.

## Compose Settings

The checked-in Compose file has two application settings:

| Setting | Default | Meaning |
| --- | ---: | --- |
| `NARRATIUM_SECRET` | required | Stable 32+ character master secret used to derive JWT and provider-key encryption keys |
| `NARRATIUM_MAX_BLOB_TOTAL_GB` | `2` | Per-account combined Blob storage in GiB; `0` is unlimited |

There is no independent file-size or file-count quota. A nonzero total quota also limits a single request to that total size. There is no server-wide output-token ceiling or built-in chat request/concurrency limit; each model's configured context window and maximum output tokens are still validated on every request.

To change the web port, edit the host side of the mapping directly:

```yaml
ports:
  - "127.0.0.1:5000:8080"
```

For example, replace `5000` with `3000`. Keeping the address on `127.0.0.1` prevents direct network access and is appropriate when a reverse proxy publishes Narratium.

PostgreSQL still requires credentials for TCP connections between containers. Compose therefore uses a fixed `narratium` password, but does not publish the PostgreSQL port to the host. This password is an internal connection credential, not the administrator password.

Keep `NARRATIUM_SECRET` unchanged and back up the `narratium-postgres` volume. Changing the secret invalidates sessions and makes saved provider keys unreadable.

## Network Security

The session cookie is suitable for loopback HTTP by default. For HTTPS, Narratium marks it `Secure` when the request uses TLS or the reverse proxy sends `X-Forwarded-Proto: https`. A reverse proxy should preserve the original `Host` header and set that protocol header.

API requests are same-origin by default. Private, loopback, and plain-HTTP provider endpoints are accepted so administrators can connect local models and gateways. Only grant administrator access to trusted people: an administrator controls backend outbound destinations and provider credentials. Use HTTPS for remote provider endpoints because plain HTTP exposes API keys and prompts in transit.

The legacy Google Analytics integration has been removed. The frontend does not load Google tracking scripts or send browser analytics.

## Channels And Models

In **Admin Panel**, configure channel Base URLs, API formats, encrypted API keys, and the original model IDs supported by each channel. OpenAI-compatible channels can use Responses or Chat Completions and can control whether Responses requests include `prompt_cache_key`. Anthropic uses Messages, and Gemini uses its native content API.

Model IDs are free-form, so local and vendor-specific names need no whitelist or display-name mapping. Configure context length, compaction threshold, maximum output tokens, reasoning, and reasoning effort on the model page. Normal users select enabled models but cannot read or change channel credentials or model capabilities.

## Verification

Run the repository checks before submitting a change:

```bash
pnpm check
pnpm test:backend:race
pnpm audit
```

Provider protocol and cache-field behavior are tested with local mock upstreams. A real cache hit requires valid provider credentials and repeated requests with a sufficiently large, stable prompt prefix; the backend records cache-read and cache-creation tokens in usage logs.
