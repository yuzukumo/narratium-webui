# Narratium

![Bannière Narratium](./public/banner.png)

Espace auto-hébergé pour le chat de personnages et la création d'histoires avec l'IA.

[English](./README.md) | [简体中文](./README_ZH.md) | [繁體中文](./README_ZH-TW.md) | [Español](./README_ES.md) | Français

Ce dépôt a été recréé à partir d'une sauvegarde locale d'un ancien fork et est maintenant maintenu par le propriétaire actuel. Le dépôt amont et les dépôts des contributeurs ne sont plus disponibles. Le dépôt actif est [yuzukumo/narratium-webui](https://github.com/yuzukumo/narratium-webui).

Ce dépôt contient uniquement le code de l'application. Il ne contient pas de cartes de personnages, d'histoires, de presets ni de contenu créé par les utilisateurs.

## Fonctionnalités

- Frontend Next.js, API Go et stockage PostgreSQL.
- Connexion avec comptes administrateur et utilisateurs ordinaires.
- Stockage serveur des cartes, images, dialogues, presets, livres du monde, scripts regex et préférences.
- Import de cartes SillyTavern PNG, JSON et CharX, y compris les livres du monde, scripts regex et ressources CharX intégrés.
- Configuration administrateur des canaux API et des modèles.
- Adaptateurs OpenAI Responses, OpenAI Chat Completions, Anthropic Messages et Gemini `generateContent`.
- Streaming, dialogues ramifiés, gestion du contexte, cache des prompts, facturation et journaux d'utilisation.

## Démarrage rapide

Prérequis : Docker Compose.

```bash
export NARRATIUM_SECRET='remplacez-par-une-valeur-aleatoire-stable-de-32-caracteres'
docker compose up -d --build
```

Ouvrez <http://localhost:5000>. Le premier compte créé devient directement administrateur. `NARRATIUM_SECRET` est obligatoire et ne doit jamais changer après la première utilisation.

Dans **Admin Panel**, créez un canal API, choisissez son protocole, puis renseignez l'URL de base, la clé et les identifiants originaux des modèles disponibles. Les identifiants sont libres. Les utilisateurs ordinaires ne peuvent sélectionner que les modèles des canaux activés.

Le port se configure directement dans `docker-compose.yml`. `NARRATIUM_MAX_BLOB_TOTAL_GB` vaut `2` par défaut ; utilisez `0` pour désactiver la limite totale de stockage par utilisateur.

Sauvegardez `narratium-postgres` et conservez `NARRATIUM_SECRET` dans un gestionnaire de mots de passe sécurisé.

## Développement

Outils : Node.js `24.18.0` LTS, pnpm `11.12.0`, Go `1.26.5` et PostgreSQL `18`.

```bash
pnpm install --frozen-lockfile
```

Consultez le [guide de démarrage](./docs/GETTING_STARTED.md) pour lancer le backend et le frontend. Vérifications :

```bash
pnpm typecheck
pnpm lint
pnpm test
pnpm test:backend:race
pnpm build
```

## Licence

Distribué sous [licence MIT](./LICENSE). Le contenu importé ou généré reste soumis aux conditions de sa source et de son créateur.

## Liens

- [Guide de démarrage](./docs/GETTING_STARTED.md)
- [Issues](https://github.com/yuzukumo/narratium-webui/issues)
- [Licence](./LICENSE)
