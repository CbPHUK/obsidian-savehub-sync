import {
  App,
  Notice,
  Plugin,
  PluginSettingTab,
  Setting,
  TFile,
  normalizePath,
} from "obsidian";

// ─── Settings ────────────────────────────────────────────────────────────────

interface SaveHubSettings {
  apiUrl: string;
  token: string;
  syncInterval: number; // minutes; 0 = manual only
  vaultFolder: string;
  lastSync: string; // ISO datetime (UTC)
  totalNoteCount: number; // running total for status bar
  createDashboard: boolean;
  createFolderIndex: boolean;
  extractTags: boolean;
  filenameFormat: "id-first" | "title-first";
}

const DEFAULT_SETTINGS: SaveHubSettings = {
  apiUrl: "",
  token: "",
  syncInterval: 30,
  vaultFolder: "SaveHub",
  lastSync: "",
  totalNoteCount: 0,
  createDashboard: true,
  createFolderIndex: true,
  extractTags: true,
  filenameFormat: "id-first",
};

// ─── API types ────────────────────────────────────────────────────────────────

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

// ─── Plugin ───────────────────────────────────────────────────────────────────

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

  // ─── Auto-sync ─────────────────────────────────────────────────────────────

  startAutoSync() {
    this.stopAutoSync();
    const ms = this.settings.syncInterval * 60 * 1000;
    this.syncNotes();
    this.syncTimer = window.setInterval(() => this.syncNotes(), ms);
  }

  stopAutoSync() {
    if (this.syncTimer !== null) {
      window.clearInterval(this.syncTimer);
      this.syncTimer = null;
    }
  }

  // ─── Status bar ────────────────────────────────────────────────────────────

  updateStatusBar(
    state: "idle" | "syncing" | "error",
    noteCount?: number,
    timeStr?: string
  ) {
    const icons: Record<string, string> = {
      idle: "☁",
      syncing: "↻",
      error: "⚠",
    };
    let label = `${icons[state]} SaveHub`;
    if (state === "idle" && (noteCount !== undefined || timeStr)) {
      const parts: string[] = [];
      if (noteCount !== undefined) parts.push(`${noteCount} notes`);
      if (timeStr) parts.push(timeStr);
      label += ` (${parts.join(" · ")})`;
    } else if (state === "error") {
      label += " (error)";
    } else if (state === "syncing") {
      label += " …";
    }
    this.statusBarItem.setText(label);
  }

  // ─── Sync ──────────────────────────────────────────────────────────────────

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
        this.updateStatusBar("error");
        new Notice("SaveHub: invalid token. Get a new one with /connect.");
        return;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      const data: SyncResponse = await res.json();
      const count = await this.writeNotes(data.notes);

      this.settings.lastSync = data.server_time;
      this.settings.totalNoteCount += count;
      await this.saveSettings();

      const now = new Date().toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
      });
      this.updateStatusBar("idle", this.settings.totalNoteCount, now);
      if (count > 0)
        new Notice(`SaveHub: synced ${count} note${count === 1 ? "" : "s"}`);
    } catch (e) {
      this.updateStatusBar("error");
      new Notice(`SaveHub sync error: ${e.message}`);
    }
  }

  // ─── Write notes ───────────────────────────────────────────────────────────

  async writeNotes(notes: SaveHubNote[]): Promise<number> {
    if (notes.length === 0) return 0;

    // Group notes by effective folder name
    const byFolder = new Map<string, SaveHubNote[]>();
    for (const note of notes) {
      const folder = note.folder || "Входящие";
      if (!byFolder.has(folder)) byFolder.set(folder, []);
      byFolder.get(folder)!.push(note);
    }

    // Ensure root vault folder exists
    const rootPath = normalizePath(this.settings.vaultFolder);
    if (!(await this.app.vault.adapter.exists(rootPath))) {
      await this.app.vault.createFolder(rootPath);
    }

    let count = 0;

    for (const [folderName, folderNotes] of byFolder) {
      const folderPath = normalizePath(`${this.settings.vaultFolder}/${folderName}`);

      if (!(await this.app.vault.adapter.exists(folderPath))) {
        await this.app.vault.createFolder(folderPath);
      }

      // Collect filenames in this folder for "See also" cross-references
      const folderFilenames = folderNotes.map((n) => this.buildFilename(n));

      for (const note of folderNotes) {
        const filename = this.buildFilename(note);
        const filePath = normalizePath(`${folderPath}/${filename}.md`);

        const siblings =
          folderFilenames.length > 1
            ? folderFilenames.filter((f) => f !== filename)
            : [];

        const mdContent = this.noteToMd(note, siblings);

        const existing = this.app.vault.getAbstractFileByPath(filePath);
        if (existing instanceof TFile) {
          await this.app.vault.modify(existing, mdContent);
        } else {
          await this.app.vault.create(filePath, mdContent);
        }
        count++;
      }

      if (this.settings.createFolderIndex) {
        await this.writeFolderIndex(folderName, folderPath, folderNotes);
      }
    }

    if (this.settings.createDashboard) {
      await this.writeDashboard(this.settings.totalNoteCount + count);
    }

    return count;
  }

  // ─── Filename helpers ──────────────────────────────────────────────────────

  buildFilename(note: SaveHubNote): string {
    const snippet = note.content
      .split("\n")[0]
      .slice(0, 40)
      .replace(/[\\/:*?"<>|]/g, "")
      .trim() || "note";

    if (this.settings.filenameFormat === "title-first") {
      return `${snippet} (${note.id})`;
    }
    return `${note.id} ${snippet}`;
  }

  // ─── Tag extraction ────────────────────────────────────────────────────────

  extractTags(content: string): string[] {
    // Match #word (Unicode-aware, skip URLs)
    const tagRegex = /(?<![/\w])#([\p{L}\p{N}_]+)/gu;
    const tags: string[] = [];
    const seen = new Set<string>();
    let match: RegExpExecArray | null;
    while ((match = tagRegex.exec(content)) !== null) {
      const tag = match[1].toLowerCase();
      if (!seen.has(tag)) {
        seen.add(tag);
        tags.push(tag);
      }
    }
    return tags;
  }

  // ─── Note → Markdown ───────────────────────────────────────────────────────

  noteToMd(note: SaveHubNote, siblings: string[] = []): string {
    const tags = this.settings.extractTags ? this.extractTags(note.content) : [];

    const lines = ["---"];
    lines.push(`id: ${note.id}`);
    lines.push(`created: "${note.created_at}"`);
    if (note.folder) lines.push(`folder: "${note.folder}"`);
    if (note.source_name) lines.push(`source_name: "${note.source_name}"`);
    if (note.source_url) lines.push(`source_url: "${note.source_url}"`);
    if (note.done) lines.push("done: true");
    if (tags.length > 0) lines.push(`tags: [${tags.join(", ")}]`);
    lines.push("---");
    lines.push("");
    lines.push(note.content);
    lines.push("");

    // "See also" section with same-folder siblings
    if (siblings.length > 0) {
      lines.push("---");
      const links = siblings.map((s) => `[[${s}]]`).join(" · ");
      lines.push(`*${links}*`);
      lines.push("");
    }

    return lines.join("\n");
  }

  // ─── Folder index ──────────────────────────────────────────────────────────

  async writeFolderIndex(
    folderName: string,
    folderPath: string,
    notes: SaveHubNote[]
  ): Promise<void> {
    const indexPath = normalizePath(`${folderPath}/_index.md`);
    const links = notes
      .map((n) => `[[${this.buildFilename(n)}]]`)
      .join(" · ");

    const content = [
      "---",
      `savehub: index`,
      `folder: "${folderName}"`,
      "---",
      "",
      `# 📁 ${folderName}`,
      "",
      links,
      "",
    ].join("\n");

    const existing = this.app.vault.getAbstractFileByPath(indexPath);
    if (existing instanceof TFile) {
      await this.app.vault.modify(existing, content);
    } else {
      await this.app.vault.create(indexPath, content);
    }
  }

  // ─── Dashboard ─────────────────────────────────────────────────────────────

  async writeDashboard(noteCount: number): Promise<void> {
    const dashPath = normalizePath(`${this.settings.vaultFolder}/_Dashboard.md`);
    const now = new Date();
    const pad = (n: number) => String(n).padStart(2, "0");
    const humanDate = `${pad(now.getDate())}.${pad(now.getMonth() + 1)}.${now.getFullYear()} ${pad(now.getHours())}:${pad(now.getMinutes())}`;
    const isoDate = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}`;
    const vault = this.settings.vaultFolder;

    const content = [
      "---",
      `savehub: dashboard`,
      `updated: "${isoDate}"`,
      "---",
      "",
      "# 🏮 SaveHub",
      "",
      `> Синхронизировано: ${humanDate} · ${noteCount} заметки`,
      "",
      "## 📋 Последние заметки",
      "```dataview",
      `TABLE created, folder as "Папка" FROM "${vault}"`,
      `WHERE savehub != "dashboard" AND savehub != "index"`,
      "SORT created DESC",
      "LIMIT 10",
      "```",
      "",
      "## ✅ Задачи",
      "```dataview",
      `LIST FROM "${vault}"`,
      `WHERE done = true AND savehub != "dashboard" AND savehub != "index"`,
      "```",
      "",
      "## 📁 Папки",
      "```dataview",
      `TABLE length(rows) as "Заметок" FROM "${vault}"`,
      `WHERE savehub != "dashboard" AND savehub != "index"`,
      "GROUP BY folder",
      "```",
      "",
    ].join("\n");

    const existing = this.app.vault.getAbstractFileByPath(dashPath);
    if (existing instanceof TFile) {
      await this.app.vault.modify(existing, content);
    } else {
      await this.app.vault.create(dashPath, content);
    }
  }

  // ─── Persistence ───────────────────────────────────────────────────────────

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }
}

// ─── Settings tab ─────────────────────────────────────────────────────────────

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

    // ── Connection ──────────────────────────────────────────────────────────

    containerEl.createEl("h3", { text: "Connection" });

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

    // ── Storage ─────────────────────────────────────────────────────────────

    containerEl.createEl("h3", { text: "Storage" });

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
      .setName("Filename format")
      .setDesc(
        "id-first: \"42 Note title.md\" · title-first: \"Note title (42).md\""
      )
      .addDropdown((drop) =>
        drop
          .addOption("id-first", "ID first (42 Note title)")
          .addOption("title-first", "Title first (Note title (42))")
          .setValue(this.plugin.settings.filenameFormat)
          .onChange(async (value) => {
            this.plugin.settings.filenameFormat = value as "id-first" | "title-first";
            await this.plugin.saveSettings();
          })
      );

    // ── Features ────────────────────────────────────────────────────────────

    containerEl.createEl("h3", { text: "Features" });

    new Setting(containerEl)
      .setName("Create dashboard note")
      .setDesc(
        "Generate _Dashboard.md at the root of your SaveHub folder on every sync. " +
        "Requires the Dataview plugin for live queries."
      )
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.createDashboard)
          .onChange(async (value) => {
            this.plugin.settings.createDashboard = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Create folder index notes")
      .setDesc(
        "Generate _index.md inside each subfolder with wikilinks to all notes in that folder."
      )
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.createFolderIndex)
          .onChange(async (value) => {
            this.plugin.settings.createFolderIndex = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Extract hashtags to frontmatter")
      .setDesc(
        "Scan note content for #hashtags and add them to the YAML frontmatter as a tags list."
      )
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.extractTags)
          .onChange(async (value) => {
            this.plugin.settings.extractTags = value;
            await this.plugin.saveSettings();
          })
      );

    // ── Sync schedule ───────────────────────────────────────────────────────

    containerEl.createEl("h3", { text: "Sync" });

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
        text: `Last sync: ${new Date(
          this.plugin.settings.lastSync.replace(" ", "T") + "Z"
        ).toLocaleString()}`,
        cls: "mod-muted",
      });
    }
  }
}
