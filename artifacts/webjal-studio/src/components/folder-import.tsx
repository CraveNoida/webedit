import React, { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { FolderOpen, Upload, Loader2, CheckCircle2, AlertCircle } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

const IMAGE_EXTS = new Set([".jpg", ".jpeg", ".png", ".webp", ".gif", ".svg", ".ico", ".bmp"]);
const CSS_EXTS = new Set([".css"]);
const JS_EXTS = new Set([".js"]);
const HTML_EXTS = new Set([".html", ".htm"]);
const SKIP_DIRS = ["node_modules", ".git", "vendor", "dist", "build", "__pycache__"];

function getExt(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot >= 0 ? name.slice(dot).toLowerCase() : "";
}

function shouldSkip(path: string): boolean {
  return SKIP_DIRS.some((d) => path.includes(`/${d}/`) || path.includes(`\\${d}\\`));
}

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

async function uploadFile(
  file: File,
  toast: ReturnType<typeof useToast>["toast"]
): Promise<string | null> {
  const fd = new FormData();
  fd.append("file", file);
  try {
    const r = await fetch("/api/uploads", { method: "POST", body: fd });
    if (!r.ok) throw new Error();
    const d = await r.json();
    return d.url as string;
  } catch {
    toast({ title: `Failed to upload ${file.name}`, variant: "destructive" });
    return null;
  }
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

function buildImageMap(relPath: string, url: string, map: Map<string, string>) {
  map.set(relPath, url);
  map.set(`./${relPath}`, url);
  const filename = relPath.split("/").pop()!;
  if (!map.has(filename)) map.set(filename, url);
}

function stripLocalRefs(html: string): string {
  return html
    .replace(/<link\b[^>]*\bhref=["'](?!https?:\/\/|\/\/)([^"']+\.css)["'][^>]*>/gi, "")
    .replace(/<script\b[^>]*\bsrc=["'](?!https?:\/\/|\/\/)([^"']+\.js)["'][^>]*><\/script>/gi, "");
}

export interface FolderImportResult {
  html: string;
  css: string;
  js: string;
}

interface FolderImportProps {
  onImport: (result: FolderImportResult) => void;
}

type Status = "idle" | "processing" | "done" | "error";

export function FolderImport({ onImport }: FolderImportProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [status, setStatus] = useState<Status>("idle");
  const [msg, setMsg] = useState("");
  const [summary, setSummary] = useState<string[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();

  async function process(
    htmlFiles: { name: string; text: () => Promise<string> }[],
    cssFiles: { name: string; text: () => Promise<string> }[],
    jsFiles: { name: string; skip?: boolean; text: () => Promise<string> }[],
    imageEntries: { relPath: string; file: File }[]
  ) {
    const summaryLines: string[] = [
      `Found: ${htmlFiles.length} HTML · ${cssFiles.length} CSS · ${jsFiles.length} JS · ${imageEntries.length} images`,
    ];

    setMsg(`Uploading ${imageEntries.length} image(s)…`);
    const imageMap = new Map<string, string>();
    let uploadedCount = 0;
    await Promise.all(
      imageEntries.map(async ({ relPath, file }) => {
        const url = await uploadFile(file, toast);
        if (url) {
          buildImageMap(relPath, url, imageMap);
          uploadedCount++;
        }
      })
    );
    if (uploadedCount > 0) summaryLines.push(`Uploaded ${uploadedCount} image(s)`);

    setMsg("Reading HTML…");
    let html = "";
    if (htmlFiles.length > 0) {
      html = await htmlFiles[0].text();
      summaryLines.push(`HTML: ${htmlFiles[0].name}`);
    }

    setMsg("Reading CSS…");
    const cssChunks: string[] = [];
    for (const f of cssFiles) {
      const t = await f.text();
      if (t.trim()) cssChunks.push(`/* ── ${f.name} ── */\n${t}`);
    }
    const css = cssChunks.join("\n\n");
    if (cssFiles.length) summaryLines.push(`CSS: ${cssFiles.length} file(s) merged`);

    setMsg("Reading JS…");
    const jsChunks: string[] = [];
    for (const f of jsFiles) {
      if (f.skip) continue;
      const t = await f.text();
      if (t.trim()) jsChunks.push(`/* ── ${f.name} ── */\n${t}`);
    }
    const js = jsChunks.join("\n\n");
    if (jsFiles.filter((f) => !f.skip).length) summaryLines.push(`JS: ${jsFiles.filter((f) => !f.skip).length} file(s) merged`);

    setMsg("Replacing image references…");
    let processedHtml = replaceRefs(html, imageMap);
    let processedCss = replaceRefs(css, imageMap);
    processedHtml = stripLocalRefs(processedHtml);
    if (uploadedCount > 0) summaryLines.push("Image references updated in HTML/CSS");

    setStatus("done");
    setMsg("");
    setSummary(summaryLines);
    onImport({ html: processedHtml, css: processedCss, js });
    toast({ title: "Folder imported! Review the code below and save." });
  }

  async function handleDrop(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setIsDragging(false);
    const items = Array.from(e.dataTransfer.items);
    const folderItem = items.find((i) => i.kind === "file");
    if (!folderItem) return;
    const entry = folderItem.webkitGetAsEntry?.();
    if (!entry?.isDirectory) {
      toast({ title: "Please drop a folder, not individual files.", variant: "destructive" });
      return;
    }
    setStatus("processing");
    setMsg("Reading folder structure…");
    try {
      const dirEntry = entry as FileSystemDirectoryEntry;
      const rootName = dirEntry.name;
      const fileEntries = await readAllEntries(dirEntry);

      const htmlFiles: { name: string; text: () => Promise<string> }[] = [];
      const cssFiles: { name: string; text: () => Promise<string> }[] = [];
      const jsFiles: { name: string; skip?: boolean; text: () => Promise<string> }[] = [];
      const imageEntries: { relPath: string; file: File }[] = [];

      for (const fe of fileEntries) {
        const ext = getExt(fe.name);
        const relPath = fe.fullPath.replace(`/${rootName}/`, "");
        if (HTML_EXTS.has(ext)) htmlFiles.push({ name: fe.name, text: async () => (await entryToFile(fe)).text() });
        else if (CSS_EXTS.has(ext)) cssFiles.push({ name: fe.name, text: async () => (await entryToFile(fe)).text() });
        else if (JS_EXTS.has(ext)) {
          const skip = fe.name.endsWith(".min.js") && jsFiles.some((j) => j.name === fe.name.replace(".min.js", ".js"));
          jsFiles.push({ name: fe.name, skip, text: async () => (await entryToFile(fe)).text() });
        } else if (IMAGE_EXTS.has(ext)) {
          const file = await entryToFile(fe);
          imageEntries.push({ relPath, file });
        }
      }

      htmlFiles.sort((a, b) => (a.name === "index.html" ? -1 : b.name === "index.html" ? 1 : 0));
      await process(htmlFiles, cssFiles, jsFiles, imageEntries);
    } catch (err) {
      console.error(err);
      setStatus("error");
    }
  }

  async function handleFileInput(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    if (!files.length) return;
    setStatus("processing");
    setMsg("Reading files…");
    try {
      const rootName = files[0]?.webkitRelativePath?.split("/")[0] ?? "";

      const htmlFiles: { name: string; text: () => Promise<string> }[] = [];
      const cssFiles: { name: string; text: () => Promise<string> }[] = [];
      const jsFiles: { name: string; skip?: boolean; text: () => Promise<string> }[] = [];
      const imageEntries: { relPath: string; file: File }[] = [];

      for (const file of files) {
        const rel = file.webkitRelativePath;
        if (shouldSkip(rel)) continue;
        const ext = getExt(file.name);
        const relPath = rel.replace(`${rootName}/`, "");
        if (HTML_EXTS.has(ext)) htmlFiles.push({ name: file.name, text: () => file.text() });
        else if (CSS_EXTS.has(ext)) cssFiles.push({ name: file.name, text: () => file.text() });
        else if (JS_EXTS.has(ext)) {
          const skip = file.name.endsWith(".min.js") && jsFiles.some((j) => j.name === file.name.replace(".min.js", ".js"));
          jsFiles.push({ name: file.name, skip, text: () => file.text() });
        } else if (IMAGE_EXTS.has(ext)) {
          imageEntries.push({ relPath, file });
        }
      }

      htmlFiles.sort((a, b) => (a.name === "index.html" ? -1 : b.name === "index.html" ? 1 : 0));
      await process(htmlFiles, cssFiles, jsFiles, imageEntries);
    } catch (err) {
      console.error(err);
      setStatus("error");
    }
  }

  return (
    <div
      onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
      onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setIsDragging(false); }}
      onDrop={handleDrop}
      className={`border-2 border-dashed rounded-xl p-8 text-center transition-all duration-200 ${
        isDragging
          ? "border-primary bg-primary/5 scale-[1.01] shadow-lg"
          : status === "done"
          ? "border-green-400 bg-green-50 dark:bg-green-900/20"
          : status === "error"
          ? "border-red-400 bg-red-50 dark:bg-red-900/20"
          : "border-muted-foreground/25 hover:border-primary/40 hover:bg-muted/20 cursor-pointer"
      }`}
      onClick={() => status === "idle" && fileInputRef.current?.click()}
    >
      {status === "processing" ? (
        <div className="flex flex-col items-center gap-3 py-2">
          <Loader2 className="h-10 w-10 text-primary animate-spin" />
          <p className="font-medium text-sm">{msg}</p>
          <p className="text-xs text-muted-foreground">This may take a moment for large folders…</p>
        </div>
      ) : status === "done" ? (
        <div className="flex flex-col items-center gap-3 py-2">
          <CheckCircle2 className="h-10 w-10 text-green-600" />
          <p className="font-semibold text-sm text-green-700 dark:text-green-300">Import complete — scroll down to review</p>
          <ul className="text-xs text-muted-foreground space-y-0.5 text-left">
            {summary.map((line, i) => (
              <li key={i} className="flex items-start gap-1.5">
                <span className="text-green-500 shrink-0">✓</span> {line}
              </li>
            ))}
          </ul>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="mt-1"
            onClick={(e) => { e.stopPropagation(); setStatus("idle"); setSummary([]); }}
          >
            Import Another Folder
          </Button>
        </div>
      ) : status === "error" ? (
        <div className="flex flex-col items-center gap-3 py-2">
          <AlertCircle className="h-10 w-10 text-red-500" />
          <p className="font-medium text-sm text-red-700 dark:text-red-300">Import failed — check the console for details</p>
          <Button type="button" variant="outline" size="sm" onClick={(e) => { e.stopPropagation(); setStatus("idle"); }}>
            Try Again
          </Button>
        </div>
      ) : (
        <div className="flex flex-col items-center gap-4 py-2">
          <div className="h-16 w-16 rounded-2xl bg-primary/10 flex items-center justify-center">
            <FolderOpen className="h-8 w-8 text-primary/60" />
          </div>
          <div className="space-y-1">
            <p className="font-semibold text-base">Drag &amp; drop your website folder here</p>
            <p className="text-sm text-muted-foreground">
              Automatically detects HTML · CSS · JS · images and wires everything together
            </p>
          </div>
          <div className="flex items-center gap-3 text-muted-foreground">
            <div className="h-px bg-border w-16" />
            <span className="text-xs">or</span>
            <div className="h-px bg-border w-16" />
          </div>
          <Button
            type="button"
            variant="outline"
            className="gap-2"
            onClick={(e) => { e.stopPropagation(); fileInputRef.current?.click(); }}
          >
            <Upload className="h-4 w-4" />
            Browse Folder
          </Button>
          <div className="flex flex-wrap justify-center gap-1.5 text-xs text-muted-foreground">
            {["index.html", "style.css", "script.js", "images/hero.jpg", "images/gallery.jpg"].map((f) => (
              <span key={f} className="bg-muted px-2 py-0.5 rounded font-mono">{f}</span>
            ))}
          </div>
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
