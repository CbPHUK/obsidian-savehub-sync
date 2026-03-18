# SaveHub Sync

Sync your [SaveHub](https://t.me/savehubbot) Telegram bot notes directly into your Obsidian vault.

## How it works

Every note you save in SaveHub (via Telegram) automatically appears in your Obsidian vault as a `.md` file, organised by folder. Sync happens automatically in the background at your chosen interval.

## Setup

1. **Get your token** — send `/connect` to the SaveHub bot in Telegram
2. **Install this plugin** — search "SaveHub Sync" in Obsidian's Community Plugins
3. **Open plugin settings** — paste your token and your SaveHub server URL
4. Done! Notes start syncing automatically

## Settings

| Setting | Description |
|---------|-------------|
| API URL | Your SaveHub server URL (e.g. `https://savehub.up.railway.app`) |
| Token | Token from `/connect` command |
| Vault folder | Folder name in your vault (default: `SaveHub`) |
| Auto-sync interval | Minutes between syncs; 0 = manual only |

## Vault structure

```
SaveHub/
  Входящие/
    1 My first note.md
  Работа/
    5 Project idea.md
  Идеи/
    12 Cool concept.md
```

Each note includes YAML frontmatter with metadata:

```yaml
---
id: 42
created: "2024-06-01 10:30:00"
source_name: "Telegram Channel"
source_url: "https://t.me/channel/123"
done: true
---
Note content here
```

## Manual sync

Run the **"SaveHub Sync: Sync notes from SaveHub"** command from the Command Palette (`Cmd/Ctrl+P`).

## Privacy

Your notes are fetched directly from your own SaveHub server using your personal token. No third parties involved.

---

Made with ❤️ by the SaveHub team
