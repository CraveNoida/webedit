import { Router } from "express";
import multer from "multer";
import path from "path";
import fs from "fs";

const router = Router();

const allowedImageExts = new Set([".jpg", ".jpeg", ".png", ".webp", ".gif", ".svg", ".ico", ".bmp", ".avif"]);

const uploadDir = path.join(process.cwd(), "uploads");
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

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

router.post("/", upload.single("file"), (req, res): void => {
  if (!req.file) {
    res.status(400).json({ error: "No file uploaded" });
    return;
  }

  const mimeType = mimeTypeForFilename(req.file.originalname, req.file.mimetype);
  const dataUrl = `data:${mimeType};base64,${req.file.buffer.toString("base64")}`;
  res.json({
    url: dataUrl,
    filename: req.file.originalname,
  });
});

router.get("/:filename", (req, res): void => {
  const filename = path.basename(req.params.filename);
  const filePath = path.join(uploadDir, filename);
  if (!fs.existsSync(filePath)) {
    res.status(404).json({ error: "File not found" });
    return;
  }
  res.sendFile(filePath);
});

export default router;
