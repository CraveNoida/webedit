import React, { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { FolderOpen, Upload, Loader2, CheckCircle2, AlertCircle } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

const IMAGE_EXTS = new Set([".jpg", ".jpeg", ".png", ".webp", ".gif", ".svg", ".ico", ".bmp", ".avif"]);
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

// ── Image embedding ───────────────────────────────────────────────────────────

async function fileToDataUrl(file: File, toast: ReturnType<typeof useToast>["toast"]): Promise<string | null> {
  try {
    return await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(file);
    });
  } catch {
    toast({ title: `Failed to read ${file.name}`, variant: "destructive" });
    return null;
  }
}

// ── HTML merging ──────────────────────────────────────────────────────────────
// Uses index.html (or first HTML) as the primary structure.
// Other HTML files are left out so multi-page template folders do not become
// one repeating single-page preview.

function mergeHtmlFiles(files: { name: string; content: string }[]): string {
  if (files.length === 0) return "";
  const index = files.find((file) => file.name.toLowerCase() === "index.html");
  return (index ?? files[0]).content;
}

// ── Reference replacement ─────────────────────────────────────────────────────

function buildImageMap(relPath: string, url: string, map: Map<string, string>) {
  const normalized = relPath.replace(/\\/g, "/").replace(/^\/+/, "");
  const filename = normalized.split("/").pop()!;
  const variants = new Set([
    normalized,
    `./${normalized}`,
    `/${normalized}`,
    `../${normalized}`,
    filename,
    `./${filename}`,
    `../${filename}`,
  ]);

  const segments = normalized.split("/");
  for (let i = 1; i < segments.length; i++) {
    const suffix = segments.slice(i).join("/");
    variants.add(suffix);
    variants.add(`./${suffix}`);
    variants.add(`/${suffix}`);
    variants.add(`../${suffix}`);
  }

  const withEncodedVariants = new Set<string>();
  variants.forEach((variant) => {
    withEncodedVariants.add(variant);
    withEncodedVariants.add(encodeURI(variant));
  });

  withEncodedVariants.forEach((variant) => {
    if (!map.has(variant)) map.set(variant, url);
  });
}

function splitUrlParts(value: string): { path: string; suffix: string } {
  const match = value.match(/^([^?#]*)([?#].*)?$/);
  return { path: match?.[1] ?? value, suffix: match?.[2] ?? "" };
}

function safeDecode(value: string): string {
  try {
    return decodeURI(value);
  } catch {
    return value;
  }
}

function replaceMappedUrl(value: string, map: Map<string, string>): string {
  const trimmed = value.trim();
  if (!trimmed || /^(?:data|blob):/i.test(trimmed)) return value;

  const { path, suffix } = splitUrlParts(trimmed);
  const candidates = [
    trimmed,
    safeDecode(trimmed),
    path,
    safeDecode(path),
    path.replace(/^\/+/, ""),
    safeDecode(path.replace(/^\/+/, "")),
  ];

  for (const candidate of candidates) {
    const mapped = map.get(candidate);
    if (mapped) return mapped + suffix;
  }

  return value;
}

function replaceSrcset(value: string, map: Map<string, string>): string {
  return value
    .split(",")
    .map((candidate) => {
      const trimmed = candidate.trim();
      if (!trimmed) return candidate;
      const [url, ...descriptors] = trimmed.split(/\s+/);
      const replaced = replaceMappedUrl(url, map);
      return [replaced, ...descriptors].join(" ");
    })
    .join(", ");
}

function replaceRefs(content: string, map: Map<string, string>): string {
  const attrs = [
    "src",
    "href",
    "poster",
    "data-src",
    "data-bg",
    "data-background",
    "data-bg-src",
    "data-lazy-src",
    "data-original",
    "data-image",
    "srcset",
    "data-srcset",
  ].join("|");

  return content
    .replace(
      new RegExp(`\\b(${attrs})\\s*=\\s*(["'])(.*?)\\2`, "gi"),
      (match, attr: string, quote: string, value: string) => {
        const replaced = /srcset$/i.test(attr) ? replaceSrcset(value, map) : replaceMappedUrl(value, map);
        return `${attr}=${quote}${replaced}${quote}`;
      }
    )
    .replace(
      new RegExp(`\\b(${attrs})\\s*=\\s*([^"'\\s>]+)`, "gi"),
      (match, attr: string, value: string) => {
        const replaced = /srcset$/i.test(attr) ? replaceSrcset(value, map) : replaceMappedUrl(value, map);
        return `${attr}="${replaced}"`;
      }
    )
    .replace(/url\(\s*(["']?)(.*?)\1\s*\)/gi, (match, quote: string, value: string) => {
      const replaced = replaceMappedUrl(value, map);
      return `url(${quote}${replaced}${quote})`;
    });
}

function hasAttr(tag: string, attr: string): boolean {
  return new RegExp(`\\b${attr}\\s*=`, "i").test(tag);
}

function getAttr(tag: string, attr: string): string | null {
  const quoted = tag.match(new RegExp(`\\b${attr}\\s*=\\s*(["'])(.*?)\\1`, "i"));
  if (quoted) return quoted[2];

  const unquoted = tag.match(new RegExp(`\\b${attr}\\s*=\\s*([^\\s>]+)`, "i"));
  return unquoted?.[1] ?? null;
}

function removeAttrs(tag: string, attrs: string[]): string {
  let out = tag;
  for (const attr of attrs) {
    out = out.replace(new RegExp(`\\s+${attr}\\s*=\\s*(["']).*?\\1`, "gi"), "");
    out = out.replace(new RegExp(`\\s+${attr}\\s*=\\s*[^\\s>]+`, "gi"), "");
  }
  return out;
}

function promoteLazyImages(html: string): string {
  const lazyAttrs = ["data-src", "data-lazy-src", "data-original", "data-image"];
  const bgAttrs = ["data-bg", "data-background", "data-bg-src"];

  return html
    .replace(/<img\b[^>]*>/gi, (tag) => {
      const lazyValue = lazyAttrs.map((attr) => getAttr(tag, attr)).find((value) => value?.startsWith("data:"));
      let out = tag;

      if (lazyValue) {
        if (hasAttr(out, "src")) {
          out = out.replace(/\bsrc\s*=\s*(["']).*?\1/i, `src="${lazyValue}"`);
          out = out.replace(/\bsrc\s*=\s*[^\s>]+/i, `src="${lazyValue}"`);
        } else {
          out = out.replace(/>$/, ` src="${lazyValue}">`);
        }
      }

      if (getAttr(out, "src")?.startsWith("data:")) {
        out = removeAttrs(out, ["srcset", "data-srcset"]);
      }

      return out;
    })
    .replace(/<source\b[^>]*>/gi, (tag) => {
      const srcset = getAttr(tag, "srcset") ?? getAttr(tag, "data-srcset");
      if (!srcset?.includes("data:")) return tag;
      return removeAttrs(tag, ["srcset", "data-srcset"]);
    })
    .replace(/<([a-z][\w:-]*)\b[^>]*>/gi, (tag) => {
      const bgValue = bgAttrs.map((attr) => getAttr(tag, attr)).find((value) => value?.startsWith("data:"));
      if (!bgValue || /<img\b/i.test(tag)) return tag;

      const style = getAttr(tag, "style");
      const nextStyle = style
        ? style.replace(/background(?:-image)?\s*:\s*url\([^)]*\)\s*;?/i, "") + `; background-image: url("${bgValue}");`
        : `background-image: url("${bgValue}");`;

      if (hasAttr(tag, "style")) {
        return tag.replace(/\bstyle\s*=\s*(["']).*?\1/i, `style="${nextStyle}"`);
      }

      return tag.replace(/>$/, ` style="${nextStyle}">`);
    });
}

function stripLocalRefs(html: string): string {
  return html
    .replace(/<link\b[^>]*\bhref=["'](?!https?:\/\/|\/\/)([^"']+\.css)["'][^>]*>/gi, "")
    .replace(/<script\b[^>]*\bsrc=["'](?!https?:\/\/|\/\/)([^"']+\.js)["'][^>]*><\/script>/gi, "");
}

// ── Core processing ───────────────────────────────────────────────────────────

type TextRec = { name: string; relPath: string; getText: () => Promise<string> };
type ImageRec = { relPath: string; file: File };

async function processFiles(
  htmlRecs: TextRec[],
  cssRecs: TextRec[],
  jsRecs: TextRec[],
  imageRecs: ImageRec[],
  setMsg: (m: string) => void,
  toast: ReturnType<typeof useToast>["toast"]
): Promise<{ html: string; css: string; js: string; summary: string[]; mergedHtmlFiles: string[]; mergedCssFiles: string[]; mergedJsFiles: string[] }> {
  const summary: string[] = [];

  // 1. Embed all images in parallel so generated sites work on any device.
  if (imageRecs.length > 0) setMsg(`Embedding ${imageRecs.length} image(s)…`);
  const imageMap = new Map<string, string>();
  let embeddedCount = 0;
  await Promise.all(
    imageRecs.map(async ({ relPath, file }) => {
      const url = await fileToDataUrl(file, toast);
      if (url) {
        buildImageMap(relPath, url, imageMap);
        embeddedCount++;
      }
    })
  );
  if (embeddedCount > 0) summary.push(`${embeddedCount} image(s) embedded`);

  // 2. Read all HTML files sequentially (preserve order)
  setMsg(`Reading ${htmlRecs.length} HTML file(s)…`);
  const htmlContents: { name: string; content: string }[] = [];
  for (const r of htmlRecs) {
    htmlContents.push({ name: r.name, content: await r.getText() });
  }
  const mergedHtml = mergeHtmlFiles(htmlContents);
  const mergedHtmlFiles = htmlRecs.map((r) => r.name);
  if (htmlRecs.length > 0) {
    const primaryName = htmlContents.find((file) => file.name.toLowerCase() === "index.html")?.name ?? htmlContents[0].name;
    const ignoredCount = Math.max(0, htmlRecs.length - 1);
    summary.push(
      ignoredCount > 0
        ? `HTML: ${primaryName} used, ${ignoredCount} extra page(s) ignored`
        : `HTML: ${primaryName}`
    );
  }

  // 3. Read all CSS files
  setMsg(`Reading ${cssRecs.length} CSS file(s)…`);
  const cssChunks: string[] = [];
  for (const r of cssRecs) {
    const t = await r.getText();
    if (t.trim()) cssChunks.push(`/* ── ${r.name} ── */\n${t}`);
  }
  const css = cssChunks.join("\n\n");
  const mergedCssFiles = cssRecs.map((r) => r.name);
  if (cssRecs.length > 0) summary.push(`CSS: ${mergedCssFiles.join(" + ")}`);

  // 4. Read all JS files
  setMsg(`Reading ${jsRecs.length} JS file(s)…`);
  const jsChunks: string[] = [];
  for (const r of jsRecs) {
    const t = await r.getText();
    if (t.trim()) jsChunks.push(`/* ── ${r.name} ── */\n${t}`);
  }
  const js = jsChunks.join("\n\n");
  const mergedJsFiles = jsRecs.map((r) => r.name);
  if (jsRecs.length > 0) summary.push(`JS: ${mergedJsFiles.join(" + ")}`);

  // 5. Replace image refs in HTML and CSS, strip local <link>/<script src>
  if (embeddedCount > 0) setMsg("Replacing image references…");
  const html = stripLocalRefs(promoteLazyImages(replaceRefs(mergedHtml, imageMap)));
  const processedCss = replaceRefs(css, imageMap);
  if (embeddedCount > 0) summary.push("Image references updated in HTML/CSS");

  return { html, css: processedCss, js, summary, mergedHtmlFiles, mergedCssFiles, mergedJsFiles };
}

// ── Exported types ────────────────────────────────────────────────────────────

export interface FolderImportResult {
  html: string;
  css: string;
  js: string;
  mergedHtmlFiles: string[];
  mergedCssFiles: string[];
  mergedJsFiles: string[];
}

interface FolderImportProps {
  onImport: (result: FolderImportResult) => void;
}

type Status = "idle" | "processing" | "done" | "error";

// ── Component ─────────────────────────────────────────────────────────────────

export function FolderImport({ onImport }: FolderImportProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [status, setStatus] = useState<Status>("idle");
  const [msg, setMsg] = useState("");
  const [summary, setSummary] = useState<string[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();

  // ── From drag-drop (FileSystem API) ──────────────────────────────────────

  async function handleDirEntry(dirEntry: FileSystemDirectoryEntry) {
    setStatus("processing");
    setMsg("Reading folder…");
    try {
      const rootName = dirEntry.name;
      const fileEntries = await readAllEntries(dirEntry);

      const htmlRecs: TextRec[] = [];
      const cssRecs: TextRec[] = [];
      const jsRecs: TextRec[] = [];
      const imageRecs: ImageRec[] = [];

      for (const fe of fileEntries) {
        const ext = getExt(fe.name);
        const relPath = fe.fullPath.replace(`/${rootName}/`, "");
        if (HTML_EXTS.has(ext)) {
          htmlRecs.push({ name: fe.name, relPath, getText: async () => (await entryToFile(fe)).text() });
        } else if (CSS_EXTS.has(ext)) {
          cssRecs.push({ name: fe.name, relPath, getText: async () => (await entryToFile(fe)).text() });
        } else if (JS_EXTS.has(ext)) {
          jsRecs.push({ name: fe.name, relPath, getText: async () => (await entryToFile(fe)).text() });
        } else if (IMAGE_EXTS.has(ext)) {
          imageRecs.push({ relPath, file: await entryToFile(fe) });
        }
      }

      const result = await processFiles(htmlRecs, cssRecs, jsRecs, imageRecs, setMsg, toast);
      finish(result);
    } catch (err) {
      console.error(err);
      setStatus("error");
    }
  }

  // ── From file input (webkitdirectory) ────────────────────────────────────

  async function handleFileList(files: File[]) {
    setStatus("processing");
    setMsg("Reading files…");
    try {
      const rootName = files[0]?.webkitRelativePath?.split("/")[0] ?? "";

      const htmlRecs: TextRec[] = [];
      const cssRecs: TextRec[] = [];
      const jsRecs: TextRec[] = [];
      const imageRecs: ImageRec[] = [];

      for (const file of files) {
        const rel = file.webkitRelativePath;
        if (shouldSkip(rel)) continue;
        const ext = getExt(file.name);
        const relPath = rel.replace(`${rootName}/`, "");
        if (HTML_EXTS.has(ext)) {
          htmlRecs.push({ name: file.name, relPath, getText: () => file.text() });
        } else if (CSS_EXTS.has(ext)) {
          cssRecs.push({ name: file.name, relPath, getText: () => file.text() });
        } else if (JS_EXTS.has(ext)) {
          jsRecs.push({ name: file.name, relPath, getText: () => file.text() });
        } else if (IMAGE_EXTS.has(ext)) {
          imageRecs.push({ relPath, file });
        }
      }

      const result = await processFiles(htmlRecs, cssRecs, jsRecs, imageRecs, setMsg, toast);
      finish(result);
    } catch (err) {
      console.error(err);
      setStatus("error");
    }
  }

  function finish(result: { html: string; css: string; js: string; summary: string[]; mergedHtmlFiles: string[]; mergedCssFiles: string[]; mergedJsFiles: string[] }) {
    setStatus("done");
    setMsg("");
    setSummary(result.summary);
    onImport({ html: result.html, css: result.css, js: result.js, mergedHtmlFiles: result.mergedHtmlFiles, mergedCssFiles: result.mergedCssFiles, mergedJsFiles: result.mergedJsFiles });
    toast({ title: "Folder imported! Review the code below and save." });
  }

  // ── Event handlers ────────────────────────────────────────────────────────

  function handleDrop(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setIsDragging(false);
    const item = Array.from(e.dataTransfer.items).find((i) => i.kind === "file");
    if (!item) return;
    const entry = item.webkitGetAsEntry?.();
    if (!entry?.isDirectory) {
      toast({ title: "Please drop a folder, not individual files.", variant: "destructive" });
      return;
    }
    handleDirEntry(entry as FileSystemDirectoryEntry);
  }

  function handleFileInput(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    if (files.length) handleFileList(files);
  }

  function reset() {
    setStatus("idle");
    setSummary([]);
    setMsg("");
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  // ── Styles ────────────────────────────────────────────────────────────────

  const zoneClass = `border-2 border-dashed rounded-xl transition-all duration-200 ${
    isDragging
      ? "border-primary bg-primary/5 scale-[1.01] shadow-lg"
      : status === "done"
      ? "border-green-400 bg-green-50 dark:bg-green-900/20"
      : status === "error"
      ? "border-red-400 bg-red-50 dark:bg-red-900/20"
      : "border-muted-foreground/25 hover:border-primary/40 hover:bg-muted/20 cursor-pointer"
  }`;

  return (
    <div
      className={zoneClass}
      onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
      onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setIsDragging(false); }}
      onDrop={handleDrop}
      onClick={() => status === "idle" && fileInputRef.current?.click()}
    >
      {/* IDLE */}
      {status === "idle" && (
        <div className="flex flex-col items-center gap-4 p-8 text-center">
          <div className="h-16 w-16 rounded-2xl bg-primary/10 flex items-center justify-center">
            <FolderOpen className="h-8 w-8 text-primary/60" />
          </div>
          <div className="space-y-1">
            <p className="font-semibold text-base">Drag &amp; drop your website folder here</p>
            <p className="text-sm text-muted-foreground">
              All HTML · CSS · JS files are merged together — images uploaded automatically
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
          <div className="flex flex-wrap justify-center gap-1.5 mt-1">
            {["index.html", "about.html", "style.css", "animations.css", "main.js", "images/"].map((f) => (
              <span key={f} className="text-xs bg-muted px-2 py-0.5 rounded font-mono text-muted-foreground">{f}</span>
            ))}
          </div>
        </div>
      )}

      {/* PROCESSING */}
      {status === "processing" && (
        <div className="flex flex-col items-center gap-3 p-10 text-center">
          <Loader2 className="h-10 w-10 text-primary animate-spin" />
          <p className="font-medium text-sm">{msg}</p>
          <p className="text-xs text-muted-foreground">Processing all files…</p>
        </div>
      )}

      {/* DONE */}
      {status === "done" && (
        <div className="flex flex-col items-center gap-3 p-8 text-center">
          <CheckCircle2 className="h-10 w-10 text-green-600" />
          <p className="font-semibold text-sm text-green-700 dark:text-green-300">
            All files imported — scroll down to review
          </p>
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
            onClick={(e) => { e.stopPropagation(); reset(); }}
          >
            Import Another Folder
          </Button>
        </div>
      )}

      {/* ERROR */}
      {status === "error" && (
        <div className="flex flex-col items-center gap-3 p-8 text-center">
          <AlertCircle className="h-10 w-10 text-red-500" />
          <p className="font-medium text-sm text-red-700 dark:text-red-300">Import failed — check the console</p>
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
