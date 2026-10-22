# CardSpace

[简体中文](README.md) · [Contributing](CONTRIBUTING.md) · [MIT License](LICENSE)

A local-first memory workspace for people and AI agents. Save conversations from **ChatGPT and DeepSeek**, keep their original context, and find earlier questions when you need them again.

The interface focuses on search, capture, and cards. Audits, background jobs, and configuration stay out of the way until needed. Your knowledge is stored locally; no cloud account or model key is required for basic use.

## Run

Requirements: Node.js 22+ and Python 3.12 (minimum 3.10). No proprietary development tool is required.

```bash
bash scripts/setup.sh
npm start
```

Open http://127.0.0.1:8765. Development: `npm run dev`. Tests: `npm test`. Production build: `npm run build`. Source distribution: `npm run source`.

## Capture and recall

- Paste a public ChatGPT or DeepSeek `/share/…` link, conversation text, or a supported JSON file.
- One “新建记忆” composer accepts text, links, JSON, and staged files. Raw inputs persist before parsing; normal captures need no metadata form or mandatory role preview.
- Titles, summaries, and existing topics are filled by rules. Inline edits take ownership of individual fields; reimports and late AI cannot overwrite them. Autosave keeps local drafts and detects revision conflicts. Archive is reversible with undo.
- Optional metadata and semantic automation have separate opt-in scopes, a shared daily request ceiling, and an input-size limit. Existing libraries are protected during migration; no automatic bulk rewrite. Original snapshots stay separate from editable display revisions.
- Search original questions, answers, titles, and notes; open a result at its source messages.
- DeepSeek fragment messages, parent IDs, and legacy JSON are supported. Thinking fragments are retained separately from final answers and collapsed in the original view.
- Sources with missing attachments, unknown fragments, or incomplete answers are marked partial. Private account URLs and access restrictions are not bypassed.

## Architecture

React + TypeScript frontend, FastAPI service layer, SQLite / FTS5, persistent job queue, and stdio MCP adapter. Optional OpenAI-compatible model and embedding connections are disabled by default. See [architecture](docs/ARCHITECTURE.md), [adapter guide](docs/ADAPTERS.md), and [implementation scope](docs/IMPLEMENTATION.md).

Runtime data lives in the OS user application data directory. `CARDSPACE_DATA_DIR` selects a custom directory; use the same value for the API and MCP adapter. One API process per directory. Secrets and knowledge backups are excluded from the source package.

## Community

You may use, modify, redistribute, and commercialize the project under MIT. Preserve the license and copyright notice; dependencies retain their own licenses. Contributions, new source adapters, documentation, and thoughtful simplification are welcome. See [CONTRIBUTING.md](CONTRIBUTING.md), [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md), and [SECURITY.md](SECURITY.md).

Source: [DCchuan/cardspace](https://github.com/DCchuan/cardspace). See [version and release instructions](docs/RELEASE.md) for fixed releases, offline backups, and separate development branches.
