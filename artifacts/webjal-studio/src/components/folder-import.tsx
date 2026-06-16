import React, { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { FolderOpen, Upload, Loader2, CheckCircle2, AlertCircle, FileCode, FileText, Braces } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

const IMAGE_EXTS = new Set([".jpg", ".jpeg", ".png", ".webp", ".gif", ".svg", ".ico", ".bmp"]);
const CSS_EXTS = new Set([".css"]);
const JS_EXTS = new Set([".js"]);
const HTML_EXTS = new Set([".html", ".htm"]);
const SKIP_DIRS = ["node_modules", ".git", "vendor", "dist", "build", "__pycache__", ".next", ".nuxt"];

function getExt(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot >= 0 ? name.slice(dot).toLowerCase() : "";
}

function shouldSkip(path: string): boolean {
  return SKIP_DIRS.some((d) => path.includes(`/${d}/`) || path.includes(`\\${d}\\`));
}

type TextRec = { name: string; relPath: string; getText: () => Promise<string> };
type ImageRec = { name: string; relPath: string; file: File };

interface Discovered {
  htmlFiles: TextRec[];
  cssFiles: TextRec[];
  jsFiles: TextRec[];
  imageFiles: ImageRec[];
}

// ── FileSystem API helpers ────────────────────────────────────────────────────

async function readAllEntries(dirEntry: FileSystemDirectoryEntry): Promise<FileSystemFileEntry[]> {
  const reader = dirEntry.createReader();
  const entries: FileSystemEntry[] = [];
  while (true) {
    const batch = await new Promise<FileSystemEntry[]>((res, rej) => reader.readEntries(res, rej));
    if (batch.length === 0) break;
    entries.push(...batch);
  }
  const result: FileSystemFileEntry[] = [];
  for (const entry of entries) {
    if (shouldSkip(entry.fullPath)) continue;
    if (entry.isDirectory) {
      result.push(...(await readAllEntries(entry as FileSystemDirectoryEntry)));
    } else {
      result.push(entry as FileSystemFileEntry);
    }
  }
  return result;
}

function entryToFile(entry: FileSystemFileEntry): Promise<File> {
  return new Promise((res, rej) => entry.file(res, rej));
}

// ── Image upload ──────────────────────────────────────────────────────────────

async function uploadFile(file: File, toast: ReturnType<typeof useToast>["toast"]): Promise<string | null> {
  const fd = new FormData();
  fd.append("file", file);
  try {
    const r = await fetch("/api/uploads", { method: "POST", body: fd });
    if (!r.ok) throw new Error();
    return ((await r.json()) as { url: string }).url;
  } catch {
    toast({ title: `Failed to upload ${file.name}`, variant: "destructive" });
    return null;
  }
}

// ── Reference replacement ─────────────────────────────────────────────────────

function buildImageMap(relPath: string, url: string, map: Map<string, string>) {
  map.set(relPath, url);
  map.set(`./${relPath}`, url);
  const filename = relPath.split("/").pop()!;
  if (!map.has(filename)) map.set(filename, url);
}

function replaceRefs(content: string, map: Map<string, string>): string {
  let out = content;
  map.forEach((newUrl, orig) => {
    const esc = orig.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    out = out
      .replace(new RegExp(`((?:src|href|data-src|data-bg)=["'])${esc}(["'])`, "gi"), `$1${newUrl}$2`)
      .replace(new RegExp(`(url\\(["']?)${esc}(["']?\\))`, "gi"), `$1${newUrl}$2`);
  });
  return out;
}

function stripLocalRefs(html: string): string {
  return html
    .replace(/<link\b[^>]*\bhref=["'](?!https?:\/\/|\/\/)([^"']+\.css)["'][^>]*>/gi, "")
    .replace(/<script\b[^>]*\bsrc=["'](?!https?:\/\/|\/\/)([^"']+\.js)["'][^>]*><\/script>/gi, "");
}

// ── Exported types ────────────────────────────────────────────────────────────

export interface FolderImportResult {
  html: string;
  css: string;
  js: string;
}

interface FolderImportProps {
  onImport: (result: FolderImportResult) => void;
}

type Status = "idle" | "scanning" | "selecting" | "processing" | "done" | "error";

// ── Component ─────────────────────────────────────────────────────────────────

export function FolderImport({ onImport }: FolderImportProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [status, setStatus] = useState<Status>("idle");
  const [msg, setMsg] = useState("");
  const [summary, setSummary] = useState<string[]>([]);
  const [discovered, setDiscovered] = useState<Discovered | null>(null);
  const [selectedHtml, setSelectedHtml] = useState<string>("");
  const [selectedCss, setSelectedCss] = useState<Set<string>>(new Set());
  const [selectedJs, setSelectedJs] = useState<Set<string>>(new Set());
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();

  function showSelectionFor(disc: Discovered) {
    // Default selections: prefer index.html, all CSS/JS checked
    const defaultHtml = disc.htmlFiles.find((f) => f.name === "index.html")?.relPath ?? disc.htmlFiles[0]?.relPath ?? "";
    setSelectedHtml(defaultHtml);
    setSelectedCss(new Set(disc.cssFiles.map((f) => f.relPath)));
    setSelectedJs(new Set(disc.jsFiles.map((f) => f.relPath)));
    setDiscovered(disc);
    setStatus("selecting");
  }

  // ── Scanning: FileSystem API (drag-drop) ──────────────────────────────────

  async function scanFromDirEntry(dirEntry: FileSystemDirectoryEntry) {
    setStatus("scanning");
    setMsg("Reading folder structure…");
    try {
      const rootName = dirEntry.name;
      const fileEntries = await readAllEntries(dirEntry);

      const disc: Discovered = { htmlFiles: [], cssFiles: [], jsFiles: [], imageFiles: [] };

      for (const fe of fileEntries) {
        const ext = getExt(fe.name);
        const relPath = fe.fullPath.replace(`/${rootName}/`, "");
        if (HTML_EXTS.has(ext)) {
          disc.htmlFiles.push({ name: fe.name, relPath, getText: async () => (await entryToFile(fe)).text() });
        } else if (CSS_EXTS.has(ext)) {
          disc.cssFiles.push({ name: fe.name, relPath, getText: async () => (await entryToFile(fe)).text() });
        } else if (JS_EXTS.has(ext)) {
          disc.jsFiles.push({ name: fe.name, relPath, getText: async () => (await entryToFile(fe)).text() });
        } else if (IMAGE_EXTS.has(ext)) {
          const file = await entryToFile(fe);
          disc.imageFiles.push({ name: fe.name, relPath, file });
        }
      }

      showSelectionFor(disc);
    } catch (err) {
      console.error(err);
      setStatus("error");
    }
  }

  // ── Scanning: File input (browse) ─────────────────────────────────────────

  async function scanFromFileList(files: File[]) {
    setStatus("scanning");
    setMsg("Reading files…");
    try {
      const rootName = files[0]?.webkitRelativePath?.split("/")[0] ?? "";
      const disc: Discovered = { htmlFiles: [], cssFiles: [], jsFiles: [], imageFiles: [] };

      for (const file of files) {
        const rel = file.webkitRelativePath;
        if (shouldSkip(rel)) continue;
        const ext = getExt(file.name);
        const relPath = rel.replace(`${rootName}/`, "");
        if (HTML_EXTS.has(ext)) {
          disc.htmlFiles.push({ name: file.name, relPath, getText: () => file.text() });
        } else if (CSS_EXTS.has(ext)) {
          disc.cssFiles.push({ name: file.name, relPath, getText: () => file.text() });
        } else if (JS_EXTS.has(ext)) {
          disc.jsFiles.push({ name: file.name, relPath, getText: () => file.text() });
        } else if (IMAGE_EXTS.has(ext)) {
          disc.imageFiles.push({ name: file.name, relPath, file });
        }
      }

      showSelectionFor(disc);
    } catch (err) {
      console.error(err);
      setStatus("error");
    }
  }

  // ── Processing: after user confirms selection ─────────────────────────────

  async function processSelected() {
    if (!discovered) return;
    setStatus("processing");

    try {
      const htmlRec = discovered.htmlFiles.find((f) => f.relPath === selectedHtml);
      const cssRecs = discovered.cssFiles.filter((f) => selectedCss.has(f.relPath));
      const jsRecs = discovered.jsFiles.filter((f) => selectedJs.has(f.relPath));
      const imageFiles = discovered.imageFiles;

      const summaryLines: string[] = [
        `HTML: ${htmlRec?.name ?? "none"} · CSS: ${cssRecs.length} file(s) · JS: ${jsRecs.length} file(s) · Images: ${imageFiles.length}`,
      ];

      // Upload images
      setMsg(`Uploading ${imageFiles.length} image(s)…`);
      const imageMap = new Map<string, string>();
      let uploadedCount = 0;
      await Promise.all(
        imageFiles.map(async ({ relPath, file }) => {
          const url = await uploadFile(file, toast);
          if (url) {
            buildImageMap(relPath, url, imageMap);
            uploadedCount++;
          }
        })
      );
      if (uploadedCount > 0) summaryLines.push(`Uploaded ${uploadedCount} image(s)`);

      // Read HTML
      setMsg("Reading HTML…");
      let html = htmlRec ? await htmlRec.getText() : "";

      // Read CSS (all selected, concatenated)
      setMsg("Reading CSS…");
      const cssChunks: string[] = [];
      for (const rec of cssRecs) {
        const t = await rec.getText();
        if (t.trim()) cssChunks.push(`/* ── ${rec.name} ── */\n${t}`);
      }
      const css = cssChunks.join("\n\n");

      // Read JS (all selected, concatenated)
      setMsg("Reading JS…");
      const jsChunks: string[] = [];
      for (const rec of jsRecs) {
        const t = await rec.getText();
        if (t.trim()) jsChunks.push(`/* ── ${rec.name} ── */\n${t}`);
      }
      const js = jsChunks.join("\n\n");

      // Replace image references
      setMsg("Replacing image references…");
      let processedHtml = replaceRefs(html, imageMap);
      let processedCss = replaceRefs(css, imageMap);
      processedHtml = stripLocalRefs(processedHtml);
      if (uploadedCount > 0) summaryLines.push("Image references updated");

      setStatus("done");
      setMsg("");
      setSummary(summaryLines);
      onImport({ html: processedHtml, css: processedCss, js });
      toast({ title: "Folder imported! Review the code below and save." });
    } catch (err) {
      console.error(err);
      setStatus("error");
    }
  }

  // ── Event handlers ────────────────────────────────────────────────────────

  function handleDrop(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setIsDragging(false);
    const folderItem = Array.from(e.dataTransfer.items).find((i) => i.kind === "file");
    if (!folderItem) return;
    const entry = folderItem.webkitGetAsEntry?.();
    if (!entry?.isDirectory) {
      toast({ title: "Please drop a folder, not individual files.", variant: "destructive" });
      return;
    }
    scanFromDirEntry(entry as FileSystemDirectoryEntry);
  }

  function handleFileInput(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    if (files.length) scanFromFileList(files);
  }

  function reset() {
    setStatus("idle");
    setSummary([]);
    setDiscovered(null);
    setSelectedHtml("");
    setSelectedCss(new Set());
    setSelectedJs(new Set());
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  function toggleCss(relPath: string) {
    setSelectedCss((prev) => {
      const next = new Set(prev);
      next.has(relPath) ? next.delete(relPath) : next.add(relPath);
      return next;
    });
  }

  function toggleJs(relPath: string) {
    setSelectedJs((prev) => {
      const next = new Set(prev);
      next.has(relPath) ? next.delete(relPath) : next.add(relPath);
      return next;
    });
  }

  // ── Render helpers ────────────────────────────────────────────────────────

  const dropZoneClass = `border-2 border-dashed rounded-xl transition-all duration-200 ${
    isDragging
      ? "border-primary bg-primary/5 scale-[1.01] shadow-lg"
      : status === "done"
      ? "border-green-400 bg-green-50 dark:bg-green-900/20"
      : status === "error"
      ? "border-red-400 bg-red-50 dark:bg-red-900/20"
      : status === "selecting"
      ? "border-primary/40 bg-muted/10"
      : "border-muted-foreground/25 hover:border-primary/40 hover:bg-muted/20 cursor-pointer"
  }`;

  return (
    <div
      className={dropZoneClass}
      onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
      onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setIsDragging(false); }}
      onDrop={handleDrop}
      onClick={() => status === "idle" && fileInputRef.current?.click()}
    >
      {/* ── IDLE ── */}
      {status === "idle" && (
        <div className="flex flex-col items-center gap-4 p-8 text-center">
          <div className="h-16 w-16 rounded-2xl bg-primary/10 flex items-center justify-center">
            <FolderOpen className="h-8 w-8 text-primary/60" />
          </div>
          <div className="space-y-1">
            <p className="font-semibold text-base">Drag &amp; drop your website folder here</p>
            <p className="text-sm text-muted-foreground">
              Detects all HTML · CSS · JS · images — you pick exactly which files to use
            </p>
          </div>
          <div className="flex items-center gap-3 text-muted-foreground">
            <div className="h-px bg-border w-16" />
            <span className="text-xs">or</span>
            <div className="h-px bg-border w-16" />
          </div>
          <Button type="button" variant="outline" className="gap-2" onClick={(e) => { e.stopPropagation(); fileInputRef.current?.click(); }}>
            <Upload className="h-4 w-4" />
            Browse Folder
          </Button>
          <div className="flex flex-wrap justify-center gap-1.5 text-xs text-muted-foreground">
            {["index.html", "about.html", "style.css", "script.js", "images/"].map((f) => (
              <span key={f} className="bg-muted px-2 py-0.5 rounded font-mono">{f}</span>
            ))}
          </div>
        </div>
      )}

      {/* ── SCANNING ── */}
      {status === "scanning" && (
        <div className="flex flex-col items-center gap-3 p-8 text-center">
          <Loader2 className="h-10 w-10 text-primary animate-spin" />
          <p className="font-medium text-sm">{msg}</p>
        </div>
      )}

      {/* ── SELECTING ── */}
      {status === "selecting" && discovered && (
        <div className="p-6 space-y-5">
          <div className="flex items-center justify-between">
            <p className="font-semibold text-sm">Choose which files to import</p>
            <button type="button" className="text-xs text-muted-foreground hover:text-foreground" onClick={reset}>✕ Cancel</button>
          </div>

          {/* HTML */}
          <div className="space-y-2">
            <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground uppercase tracking-wide">
              <FileText className="h-3.5 w-3.5" /> HTML — pick one
            </div>
            {discovered.htmlFiles.length === 0 && (
              <p className="text-xs text-muted-foreground italic">No HTML files found</p>
            )}
            <div className="flex flex-wrap gap-2">
              {discovered.htmlFiles.map((f) => (
                <button
                  key={f.relPath}
                  type="button"
                  onClick={() => setSelectedHtml(f.relPath)}
                  className={`text-xs px-3 py-1.5 rounded-lg border font-mono transition-colors ${
                    selectedHtml === f.relPath
                      ? "border-primary bg-primary text-primary-foreground"
                      : "border-border bg-muted hover:border-primary/50"
                  }`}
                >
                  {f.relPath}
                </button>
              ))}
            </div>
          </div>

          {/* CSS */}
          {discovered.cssFiles.length > 0 && (
            <div className="space-y-2">
              <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground uppercase tracking-wide">
                <FileCode className="h-3.5 w-3.5" /> CSS — select files to merge
              </div>
              <div className="flex flex-wrap gap-2">
                {discovered.cssFiles.map((f) => (
                  <label
                    key={f.relPath}
                    className={`flex items-center gap-2 text-xs px-3 py-1.5 rounded-lg border cursor-pointer font-mono transition-colors ${
                      selectedCss.has(f.relPath)
                        ? "border-blue-400 bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-300"
                        : "border-border bg-muted text-muted-foreground"
                    }`}
                  >
                    <Checkbox
                      checked={selectedCss.has(f.relPath)}
                      onCheckedChange={() => toggleCss(f.relPath)}
                      className="h-3 w-3"
                    />
                    {f.relPath}
                  </label>
                ))}
              </div>
            </div>
          )}

          {/* JS */}
          {discovered.jsFiles.length > 0 && (
            <div className="space-y-2">
              <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground uppercase tracking-wide">
                <Braces className="h-3.5 w-3.5" /> JS — select files to merge
              </div>
              <div className="flex flex-wrap gap-2">
                {discovered.jsFiles.map((f) => (
                  <label
                    key={f.relPath}
                    className={`flex items-center gap-2 text-xs px-3 py-1.5 rounded-lg border cursor-pointer font-mono transition-colors ${
                      selectedJs.has(f.relPath)
                        ? "border-amber-400 bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-300"
                        : "border-border bg-muted text-muted-foreground"
                    }`}
                  >
                    <Checkbox
                      checked={selectedJs.has(f.relPath)}
                      onCheckedChange={() => toggleJs(f.relPath)}
                      className="h-3 w-3"
                    />
                    {f.relPath}
                  </label>
                ))}
              </div>
            </div>
          )}

          {/* Images summary */}
          {discovered.imageFiles.length > 0 && (
            <p className="text-xs text-muted-foreground">
              <span className="font-medium text-foreground">{discovered.imageFiles.length} image(s)</span> will be uploaded and references auto-updated
            </p>
          )}

          <div className="flex items-center gap-3 pt-1">
            <Button
              type="button"
              className="gap-2"
              disabled={!selectedHtml && discovered.htmlFiles.length > 0}
              onClick={processSelected}
            >
              <Upload className="h-4 w-4" />
              Import Selected Files
            </Button>
            <p className="text-xs text-muted-foreground">
              {[
                selectedHtml && "1 HTML",
                selectedCss.size > 0 && `${selectedCss.size} CSS`,
                selectedJs.size > 0 && `${selectedJs.size} JS`,
              ]
                .filter(Boolean)
                .join(" · ")}
            </p>
          </div>
        </div>
      )}

      {/* ── PROCESSING ── */}
      {status === "processing" && (
        <div className="flex flex-col items-center gap-3 p-8 text-center">
          <Loader2 className="h-10 w-10 text-primary animate-spin" />
          <p className="font-medium text-sm">{msg}</p>
          <p className="text-xs text-muted-foreground">Uploading images and processing code…</p>
        </div>
      )}

      {/* ── DONE ── */}
      {status === "done" && (
        <div className="flex flex-col items-center gap-3 p-8 text-center">
          <CheckCircle2 className="h-10 w-10 text-green-600" />
          <p className="font-semibold text-sm text-green-700 dark:text-green-300">Import complete — scroll down to review</p>
          <ul className="text-xs text-muted-foreground space-y-0.5 text-left">
            {summary.map((line, i) => (
              <li key={i} className="flex items-start gap-1.5">
                <span className="text-green-500 shrink-0">✓</span> {line}
              </li>
            ))}
          </ul>
          <Button type="button" variant="outline" size="sm" className="mt-1" onClick={(e) => { e.stopPropagation(); reset(); }}>
            Import Another Folder
          </Button>
        </div>
      )}

      {/* ── ERROR ── */}
      {status === "error" && (
        <div className="flex flex-col items-center gap-3 p-8 text-center">
          <AlertCircle className="h-10 w-10 text-red-500" />
          <p className="font-medium text-sm text-red-700 dark:text-red-300">Import failed</p>
          <Button type="button" variant="outline" size="sm" onClick={(e) => { e.stopPropagation(); reset(); }}>
            Try Again
          </Button>
        </div>
      )}

      <input
        ref={fileInputRef}
        type="file"
        className="hidden"
        onChange={handleFileInput}
        // @ts-expect-error webkitdirectory not in TS types
        webkitdirectory=""
        multiple
      />
    </div>
  );
}
