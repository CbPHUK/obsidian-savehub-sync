import {
  App,
  Notice,
  Plugin,
  PluginSettingTab,
  Setting,
  TFile,
  normalizePath,
} from "obsidian";

interface SaveHubSettings {
  apiUrl: string;
  token: string;
  syncInterval: number; // minutes; 0 = manual only
  vaultFolder: string;
  lastSync: string; // ISO datetime (UTC)
}

const DEFAULT_SETTINGS: SaveHubSettings = {
  apiUrl: "",
  token: "",
  syncInterval: 30,
  vaultFolder: "SaveHub",
  lastSync: "",
};

interface SaveHubNote {
  id: number;
  content: string;
  folder: string | null;
  source_name: string | null;
  source_url: string | null;
  done: number;
  created_at: string;
}

interface SyncResponse {
  notes: SaveHubNote[];
  server_time: string;
}

export default class SaveHubPlugin extends Plugin {
  settings: SaveHubSettings;
  private syncTimer: number | null = null;
  private statusBarItem: HTMLElement;

  async onload() {
    await this.loadSettings();

    this.statusBarItem = this.addStatusBarItem();
    this.updateStatusBar("idle");

    this.addCommand({
      id: "sync-notes",
      name: "Sync notes from SaveHub",
      callback: () => this.syncNotes(),
    });

    this.addSettingTab(new SaveHubSettingTab(this.app, this));

    if (this.settings.token && this.settings.syncInterval > 0) {
      this.startAutoSync();
    }
  }

  onunload() {
    this.stopAutoSync();
  }

  startAutoSync() {
    this.stopAutoSync();
    const ms = this.settings.syncInterval * 60 * 1000;
    // Sync once immediately on load, then on interval
    this.syncNotes();
    this.syncTimer = window.setInterval(() => this.syncNotes(), ms);
  }

  stopAutoSync() {
    if (this.syncTimer !== null) {
      window.clearInterval(this.syncTimer);
      this.syncTimer = null;
    }
  }

  updateStatusBar(state: "idle" | "syncing" | "error", extra?: string) {
    const icons: Record<string, string> = {
      idle: "☁",
      syncing: "↻",
      error: "⚠",
    };
    this.statusBarItem.setText(
      `${icons[state]} SaveHub${extra ? " " + extra : ""}`
    );
  }

  async syncNotes() {
    if (!this.settings.token) {
      new Notice("SaveHub: token not set. Configure in Settings → SaveHub Sync.");
      return;
    }
    if (!this.settings.apiUrl) {
      new Notice("SaveHub: API URL not set. Configure in Settings → SaveHub Sync.");
      return;
    }

    this.updateStatusBar("syncing");
    try {
      const url = new URL("/obsidian/notes", this.settings.apiUrl);
      if (this.settings.lastSync) {
        url.searchParams.set("since", this.settings.lastSync);
      }

      const res = await fetch(url.toString(), {
        headers: { Authorization: `Bearer ${this.settings.token}` },
      });

      if (res.status === 401) {
        this.updateStatusBar("error", "(invalid token)");
        new Notice("SaveHub: invalid token. Get a new one with /connect.");
        return;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      const data: SyncResponse = await res.json();
      const count = await this.writeNotes(data.notes);

      this.settings.lastSync = data.server_time;
      await this.saveSettings();

      const now = new Date().toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
      });
      this.updateStatusBar("idle", `(${now})`);
      if (count > 0) new Notice(`SaveHub: synced ${count} note${count === 1 ? "" : "s"}`);
    } catch (e) {
      this.updateStatusBar("error");
      new Notice(`SaveHub sync error: ${e.message}`);
    }
  }

  async writeNotes(notes: SaveHubNote[]): Promise<number> {
    let count = 0;
    for (const note of notes) {
      const folder = note.folder || "Входящие";
      const folderPath = normalizePath(
        `${this.settings.vaultFolder}/${folder}`
      );

      if (!(await this.app.vault.adapter.exists(folderPath))) {
        await this.app.vault.createFolder(folderPath);
      }

      const snippet = note.content
        .split("\n")[0]
        .slice(0, 40)
        .replace(/[\\/:*?"<>|]/g, "")
        .trim();
      const filePath = normalizePath(
        `${folderPath}/${note.id} ${snippet || "note"}.md`
      );
      const mdContent = this.noteToMd(note);

      const existing = this.app.vault.getAbstractFileByPath(filePath);
      if (existing instanceof TFile) {
        await this.app.vault.modify(existing, mdContent);
      } else {
        await this.app.vault.create(filePath, mdContent);
      }
      count++;
    }
    return count;
  }

  noteToMd(note: SaveHubNote): string {
    const lines = ["---"];
    lines.push(`id: ${note.id}`);
    lines.push(`created: "${note.created_at}"`);
    if (note.source_name) lines.push(`source_name: "${note.source_name}"`);
    if (note.source_url) lines.push(`source_url: "${note.source_url}"`);
    if (note.done) lines.push("done: true");
    lines.push("---", "", note.content, "");
    return lines.join("\n");
  }

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }
}

class SaveHubSettingTab extends PluginSettingTab {
  plugin: SaveHubPlugin;

  constructor(app: App, plugin: SaveHubPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.createEl("h2", { text: "SaveHub Sync" });

    new Setting(containerEl)
      .setName("API URL")
      .setDesc("Your SaveHub bot server URL (e.g. https://savehub.up.railway.app)")
      .addText((text) =>
        text
          .setPlaceholder("https://...")
          .setValue(this.plugin.settings.apiUrl)
          .onChange(async (value) => {
            this.plugin.settings.apiUrl = value.trim().replace(/\/$/, "");
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Token")
      .setDesc("Send /connect to the SaveHub bot to get your token")
      .addText((text) => {
        text.inputEl.type = "password";
        text
          .setPlaceholder("paste token here")
          .setValue(this.plugin.settings.token)
          .onChange(async (value) => {
            this.plugin.settings.token = value.trim();
            await this.plugin.saveSettings();
          });
      });

    new Setting(containerEl)
      .setName("Vault folder")
      .setDesc("Folder in your vault where notes will be created")
      .addText((text) =>
        text
          .setPlaceholder("SaveHub")
          .setValue(this.plugin.settings.vaultFolder)
          .onChange(async (value) => {
            this.plugin.settings.vaultFolder = value.trim() || "SaveHub";
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Auto-sync interval (minutes)")
      .setDesc("Set to 0 for manual sync only")
      .addText((text) =>
        text
          .setPlaceholder("30")
          .setValue(String(this.plugin.settings.syncInterval))
          .onChange(async (value) => {
            const n = Math.max(0, parseInt(value) || 0);
            this.plugin.settings.syncInterval = n;
            await this.plugin.saveSettings();
            if (n > 0 && this.plugin.settings.token) {
              this.plugin.startAutoSync();
            } else {
              this.plugin.stopAutoSync();
            }
          })
      );

    new Setting(containerEl)
      .setName("Sync now")
      .setDesc("Pull the latest notes from SaveHub immediately")
      .addButton((btn) =>
        btn
          .setButtonText("Sync")
          .setCta()
          .onClick(() => this.plugin.syncNotes())
      );

    if (this.plugin.settings.lastSync) {
      containerEl.createEl("p", {
        text: `Last sync: ${new Date(this.plugin.settings.lastSync.replace(" ", "T") + "Z").toLocaleString()}`,
        cls: "mod-muted",
      });
    }
  }
}
