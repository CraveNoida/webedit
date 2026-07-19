import { Router, type Request, type Response } from "express";
import multer from "multer";
import path from "path";
import { mongo } from "@workspace/db";
import { createMediaAsset, publicMediaAssetUrl } from "../lib/media-assets";
import { logger } from "../lib/logger";

const router = Router();

const allowedImageExts = new Set([".jpg", ".jpeg", ".png", ".webp", ".gif", ".svg", ".ico", ".bmp", ".avif"]);

const storage = multer.memoryStorage();

function mimeTypeForFilename(filename: string, fallback: string): string {
  const ext = path.extname(filename).toLowerCase();
  if (fallback && fallback !== "application/octet-stream") return fallback;
  if (ext === ".svg") return "image/svg+xml";
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".png") return "image/png";
  if (ext === ".webp") return "image/webp";
  if (ext === ".gif") return "image/gif";
  if (ext === ".ico") return "image/x-icon";
  if (ext === ".bmp") return "image/bmp";
  if (ext === ".avif") return "image/avif";
  return "image/png";
}

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, file.mimetype.startsWith("image/") || allowedImageExts.has(ext));
  },
});

router.post("/", (req, res, next) => {
  upload.single("file")(req, res, (err) => {
    if (!err) {
      next();
      return;
    }

    if (err instanceof multer.MulterError && err.code === "LIMIT_FILE_SIZE") {
      res.status(413).json({ error: "Image is too large. Use an image under 10 MB." });
      return;
    }

    next(err);
  });
}, async (req, res): Promise<void> => {
  if (!req.file) {
    res.status(400).json({ error: "No file uploaded" });
    return;
  }

  const mimeType = mimeTypeForFilename(req.file.originalname, req.file.mimetype);
  try {
    const asset = await createMediaAsset({
      filename: req.file.originalname,
      mimeType,
      buffer: req.file.buffer,
    });

    res.json({
      url: publicMediaAssetUrl(req, asset.id, asset.filename),
      filename: asset.filename,
    });
  } catch (err) {
    req.log?.warn({ err }, "Image upload storage unavailable; returning inline data URL");
    logger.warn({ err }, "Image upload storage unavailable; returning inline data URL");
    res.json({
      url: `data:${mimeType};base64,${req.file.buffer.toString("base64")}`,
      filename: req.file.originalname,
      storage: "inline",
    });
  }
});

async function sendMediaAsset(req: Request, res: Response): Promise<void> {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ error: "Invalid image id" });
    return;
  }

  const asset = await mongo.getMediaAsset(id);
  if (!asset) {
    res.status(404).json({ error: "File not found" });
    return;
  }

  const buffer = Buffer.from(asset.dataBase64, "base64");
  res.setHeader("Content-Type", asset.mimeType);
  res.setHeader("Content-Length", String(buffer.length));
  res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
  res.send(buffer);
}

router.get("/:id", sendMediaAsset);
router.get("/:id/:filename", sendMediaAsset);

export default router;
