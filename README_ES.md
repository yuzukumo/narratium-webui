# Narratium

![Narratium banner](./public/banner.png)

Espacio autoalojado para chat de personajes y creación de historias con IA.

[English](./README.md) | [简体中文](./README_ZH.md) | [繁體中文](./README_ZH-TW.md) | Español | [Français](./README_FR.md)

Este repositorio se recreó a partir de una copia local de un fork anterior y ahora lo mantiene el propietario actual. El repositorio original y los repositorios de colaboradores ya no están disponibles. El repositorio activo es [yuzukumo/narratium-webui](https://github.com/yuzukumo/narratium-webui).

Este repositorio contiene solo el código de la aplicación. No incluye tarjetas de personajes, historias, presets ni contenido creado por usuarios.

## Funciones

- Frontend Next.js, API en Go y almacenamiento PostgreSQL.
- Inicio de sesión con cuentas de administrador y usuarios normales.
- Almacenamiento en el servidor para tarjetas, imágenes, diálogos, presets, libros del mundo, scripts regex y preferencias.
- Importación de tarjetas SillyTavern PNG, JSON y CharX, incluidos libros de mundo, scripts regex y recursos CharX integrados.
- Configuración administrativa de canales API y modelos.
- Adaptadores para OpenAI Responses, OpenAI Chat Completions, Anthropic Messages y Gemini `generateContent`.
- Streaming, diálogos ramificados, gestión de contexto, caché de prompts, facturación y registros de uso.

## Inicio rápido

Requisito: Docker Compose.

```bash
export NARRATIUM_SECRET='sustituye-esto-por-un-valor-aleatorio-estable-de-32-caracteres'
docker compose up -d --build
```

Abre <http://localhost:5000>. La primera cuenta registrada correctamente se convierte directamente en administrador. `NARRATIUM_SECRET` es obligatorio y no debe cambiar después del primer uso.

En **Admin Panel**, crea un canal API, selecciona el protocolo, introduce la URL base, la clave y los IDs originales de los modelos disponibles. Los IDs son libres. Los usuarios normales solo pueden seleccionar modelos de canales activos.

El puerto se configura directamente en `docker-compose.yml`. `NARRATIUM_MAX_BLOB_TOTAL_GB` vale `2` por defecto; usa `0` para desactivar el límite total de almacenamiento por usuario.

Haz copia de seguridad de `narratium-postgres` y guarda `NARRATIUM_SECRET` en un gestor de contraseñas seguro.

## Desarrollo

Herramientas: Node.js `24.18.0` LTS, pnpm `11.12.0`, Go `1.26.5` y PostgreSQL `18`.

```bash
pnpm install --frozen-lockfile
```

Consulta la [guía de inicio](./docs/GETTING_STARTED.md) para iniciar el backend y el frontend. Ejecuta:

```bash
pnpm typecheck
pnpm lint
pnpm test
pnpm test:backend:race
pnpm build
```

## Licencia

Publicado bajo la [licencia MIT](./LICENSE). El contenido importado o generado sigue sujeto a los términos de su fuente y creador.

## Enlaces

- [Guía de inicio](./docs/GETTING_STARTED.md)
- [Issues](https://github.com/yuzukumo/narratium-webui/issues)
- [Licencia](./LICENSE)
