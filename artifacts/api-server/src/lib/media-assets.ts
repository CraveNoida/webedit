import type { Request } from "express";
import crypto from "crypto";
import path from "path";
import { db, mediaAssetsTable } from "@workspace/db";

const DATA_IMAGE_RE = /data:(image\/[a-z0-9.+-]+);base64,([a-z0-9+/=\r\n]+)(?![a-z0-9+/=])/gi;

function extensionForMimeType(mimeType: string): string {
  if (mimeType === "image/svg+xml") return ".svg";
  if (mimeType === "image/jpeg") return ".jpg";
  if (mimeType === "image/png") return ".png";
  if (mimeType === "image/webp") return ".webp";
  if (mimeType === "image/gif") return ".gif";
  if (mimeType === "image/x-icon") return ".ico";
  if (mimeType === "image/bmp") return ".bmp";
  if (mimeType === "image/avif") return ".avif";
  return ".png";
}

function cleanFilename(filename: string): string {
  const parsed = path.parse(path.basename(filename));
  const base = (parsed.name || "image").replace(/[^a-z0-9._-]+/gi, "-").replace(/^-+|-+$/g, "") || "image";
  const ext = parsed.ext.replace(/[^a-z0-9.]+/gi, "") || ".png";
  return `${base}${ext}`.slice(0, 120);
}

export function publicApiBaseUrl(req: Request): string {
  const forwardedProto = req.get("x-forwarded-proto")?.split(",")[0]?.trim();
  const forwardedHost = req.get("x-forwarded-host")?.split(",")[0]?.trim();
  const proto = forwardedProto || req.protocol || "https";
  const host = forwardedHost || req.get("host") || "webedit-api.onrender.com";
  return `${proto}://${host}`.replace(/\/+$/, "");
}

export function publicMediaAssetUrl(req: Request, id: number, filename: string): string {
  return `${publicApiBaseUrl(req)}/api/uploads/${id}/${encodeURIComponent(cleanFilename(filename))}`;
}

export async function createMediaAsset(input: {
  filename: string;
  mimeType: string;
  buffer: Buffer;
}) {
  const [asset] = await db
    .insert(mediaAssetsTable)
    .values({
      filename: cleanFilename(input.filename),
      mimeType: input.mimeType,
      dataBase64: input.buffer.toString("base64"),
    })
    .returning();

  return asset;
}

export async function persistDataImageUrls(value: string, req: Request): Promise<string> {
  if (!value.includes("data:image")) return value;

  const replacements = new Map<string, string>();
  const matches = [...value.matchAll(DATA_IMAGE_RE)];

  for (const match of matches) {
    const dataUrl = match[0];
    if (replacements.has(dataUrl)) continue;

    const mimeType = match[1].toLowerCase();
    const base64 = match[2].replace(/\s+/g, "");
    const buffer = Buffer.from(base64, "base64");
    const hash = crypto.createHash("sha1").update(buffer).digest("hex").slice(0, 12);
    const filename = `embedded-${hash}${extensionForMimeType(mimeType)}`;
    const asset = await createMediaAsset({ filename, mimeType, buffer });
    replacements.set(dataUrl, publicMediaAssetUrl(req, asset.id, asset.filename));
  }

  let out = value;
  for (const [dataUrl, url] of replacements) {
    out = out.split(dataUrl).join(url);
  }
  return out;
}
