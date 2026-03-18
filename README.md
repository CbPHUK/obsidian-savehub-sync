# SaveHub Sync

> Capture anything in Telegram. Find it in Obsidian.

**SaveHub Sync** bridges the [SaveHub Telegram bot](https://t.me/savehubbot) and your Obsidian vault. Every note you save — text, link, photo caption, voice transcription, or forwarded post — appears in your vault as a Markdown file, automatically organised by folder.

---

## Features

- **Incremental sync** — only fetches notes created since the last sync; fast and bandwidth-friendly
- **Folder structure** — mirrors your SaveHub folders as subfolders in the vault
- **Auto-sync** — runs on a configurable interval (default: every 30 minutes)
- **Dashboard note** — a `_Dashboard.md` with live [Dataview](https://github.com/blacksmithgu/obsidian-dataview) queries: recent notes, tasks, notes-per-folder breakdown
- **Folder index notes** — each subfolder gets a `_index.md` with wikilinks to every note inside, creating a rich graph
- **Hashtag extraction** — `#tags` written in Telegram appear in the YAML frontmatter, so Obsidian's tag pane and graph recognise them instantly
- **"See also" links** — notes in the same folder are linked to each other at the bottom of the file, connecting the graph
- **Configurable filenames** — choose between `42 Note title.md` (ID-first) or `Note title (42).md` (title-first)
- **Status bar** — shows total note count and last sync time at a glance
- **Works on mobile** — iOS and Android are fully supported

---

## Requirements

- An active [SaveHub bot](https://t.me/savehubbot) instance (self-hosted on Railway or similar)
- The [Dataview plugin](https://obsidian.md/plugins?id=dataview) for the dashboard queries (optional but recommended)

---

## Setup

### 1. Get your token

Open Telegram and send `/connect` to your SaveHub bot. It will reply with a personal token.

### 2. Install the plugin

Search for **SaveHub Sync** in **Settings → Community plugins → Browse**, install and enable it.

### 3. Configure

Open **Settings → SaveHub Sync** and fill in two fields:

| Field | Value |
|-------|-------|
| **API URL** | Your SaveHub server URL (e.g. `https://savehub.up.railway.app`) |
| **Token** | The token you received from `/connect` |

Everything else can stay at the defaults.

### 4. Sync

Click **Sync now** in the settings tab, or wait for the auto-sync to run. Your vault will contain:

```
SaveHub/
├── _Dashboard.md        ← live overview (requires Dataview)
├── Входящие/
│   ├── _index.md        ← wikilinks to all notes in this folder
│   ├── 1 My first note.md
│   └── 7 Interesting article.md
├── Работа/
│   ├── _index.md
│   └── 5 Project idea.md
└── Идеи/
    ├── _index.md
    └── 12 Cool concept.md
```

---

## What each note looks like

```markdown
---
id: 42
created: "2025-06-01 10:30:00"
folder: "Работа"
source_name: "TechCrunch"
source_url: "https://techcrunch.com/..."
tags: [ai, стартап, читать]
---

Интересная статья про применение LLM в продуктивности. #ai #стартап #читать

---
*[[5 Project idea]] · [[18 Meeting notes]]*
```

- **YAML frontmatter** — `id`, `created`, `folder`, `source_name`, `source_url`, `done`, `tags`
- **Content** — your original note text, unchanged
- **See also** — wikilinks to other notes in the same folder (graph connections)

---

## Settings reference

| Setting | Default | Description |
|---------|---------|-------------|
| API URL | — | SaveHub server base URL |
| Token | — | Personal API token from `/connect` |
| Vault folder | `SaveHub` | Root folder name in your vault |
| Filename format | ID first | `42 Title.md` or `Title (42).md` |
| Create dashboard | ✓ | Generate `_Dashboard.md` on every sync |
| Create folder indexes | ✓ | Generate `_index.md` per subfolder |
| Extract hashtags | ✓ | Add `#tags` to YAML frontmatter |
| Auto-sync interval | `30` min | Set to `0` for manual sync only |

---

## Privacy

- Your notes are fetched **directly from your own SaveHub server** using your personal token.
- The plugin makes HTTP requests **only** to the URL you configure — no third-party analytics, tracking, or external services.
- The token is stored locally in Obsidian's plugin data (`data.json`) and is never transmitted anywhere other than your own server.
- To revoke access, send `/connect` to the bot again — the old token is invalidated immediately.

---

## Frequently asked questions

**Do I need a GitHub account?**
No. The plugin connects directly to your SaveHub server over HTTPS.

**Will it delete notes I edit in Obsidian?**
No. The plugin only creates and updates files — it never deletes anything. Edits you make locally are preserved on the next sync (the file is overwritten only if the note was updated in SaveHub after your last sync).

**Does it work with Obsidian Sync / iCloud / Dropbox?**
Yes. The plugin writes standard Markdown files — any vault sync solution will pick them up.

**Does it work on mobile?**
Yes. iOS and Android are both supported.

**How do I stop syncing?**
Disable the plugin in **Settings → Community plugins**. Your existing files remain untouched.

---

## Contributing

Issues and pull requests are welcome at [github.com/CbPHUK/obsidian-savehub-sync](https://github.com/CbPHUK/obsidian-savehub-sync).

---

## License

[MIT](LICENSE)
