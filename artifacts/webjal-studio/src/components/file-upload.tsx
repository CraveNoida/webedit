import React, { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { UploadCloud, Loader2, X } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiUrl } from "@/lib/api-url";

const MAX_INLINE_IMAGE_BYTES = 180 * 1024;
const COMPRESSIBLE_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/bmp", "image/avif"]);

interface FileUploadProps {
  value: string;
  onChange: (url: string) => void;
  placeholder?: string;
  className?: string;
}

function dataUrlSize(dataUrl: string): number {
  return Math.ceil(dataUrl.length * 0.75);
}

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error("Failed to read file"));
    reader.readAsDataURL(file);
  });
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Failed to decode image"));
    image.src = src;
  });
}

async function compressedInlineImageUrl(file: File): Promise<string> {
  if (!COMPRESSIBLE_IMAGE_TYPES.has(file.type)) {
    if (file.size > MAX_INLINE_IMAGE_BYTES) throw new Error("Image is too large to inline");
    return fileToDataUrl(file);
  }

  const objectUrl = URL.createObjectURL(file);
  try {
    const image = await loadImage(objectUrl);
    for (const maxDimension of [1000, 760, 560]) {
      const scale = Math.min(1, maxDimension / Math.max(image.naturalWidth, image.naturalHeight));
      const width = Math.max(1, Math.round(image.naturalWidth * scale));
      const height = Math.max(1, Math.round(image.naturalHeight * scale));
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext("2d");
      if (!context) throw new Error("Canvas is not available");

      context.fillStyle = "#fff";
      context.fillRect(0, 0, width, height);
      context.drawImage(image, 0, 0, width, height);

      for (const quality of [0.76, 0.62, 0.48]) {
        const dataUrl = canvas.toDataURL("image/jpeg", quality);
        if (dataUrlSize(dataUrl) <= MAX_INLINE_IMAGE_BYTES) return dataUrl;
      }
    }

    throw new Error("Image is too large to inline");
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

async function uploadImage(file: File, toast: ReturnType<typeof useToast>["toast"]): Promise<string | null> {
  try {
    const formData = new FormData();
    formData.append("file", file);
    const response = await fetch(apiUrl("/api/uploads"), {
      method: "POST",
      body: formData,
    });
    if (!response.ok) throw new Error("Upload failed");
    const data = await response.json() as { url?: string };
    const url = data.url ? apiUrl(data.url) : "";
    if (!url) throw new Error("Upload failed");
    toast({ title: "Image added successfully" });
    return url;
  } catch {
    try {
      const url = await compressedInlineImageUrl(file);
      toast({ title: "Using compressed inline image" });
      return url;
    } catch {
      toast({ title: "Image upload failed", variant: "destructive" });
      return null;
    }
  }
}

export function FileUpload({ value, onChange, placeholder = "Upload image", className }: FileUploadProps) {
  const [isUploading, setIsUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setIsUploading(true);
    const url = await uploadImage(file, toast);
    if (url) onChange(url);
    setIsUploading(false);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  return (
    <div className={`flex items-center gap-2 ${className ?? ""}`}>
      <input type="file" ref={fileInputRef} onChange={handleFileChange} className="hidden" accept="image/*" />
      <Button
        type="button"
        variant="outline"
        className="flex-1 justify-start gap-2"
        onClick={() => fileInputRef.current?.click()}
        disabled={isUploading}
        title="Upload image"
      >
        {isUploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <UploadCloud className="h-4 w-4" />}
        {isUploading ? "Uploading..." : value ? "Change image" : placeholder}
      </Button>
      {value && (
        <>
          <img
            src={value}
            alt="preview"
            className="h-8 w-8 rounded object-cover border shrink-0"
            onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
            onLoad={(e) => { (e.target as HTMLImageElement).style.display = "block"; }}
          />
          <Button type="button" variant="ghost" size="icon" onClick={() => onChange("")} title="Remove image">
            <X className="h-4 w-4" />
          </Button>
        </>
      )}
    </div>
  );
}

interface GalleryUploadProps {
  images: string[];
  onChange: (images: string[]) => void;
  compact?: boolean;
}

export function GalleryUpload({ images, onChange, compact = false }: GalleryUploadProps) {
  const [isUploading, setIsUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();
  const imageList = Array.isArray(images) ? images : [];

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    if (!files.length) return;
    setIsUploading(true);
    const results = await Promise.all(files.map((f) => uploadImage(f, toast)));
    const urls = results.filter((u): u is string => u !== null);
    if (urls.length) onChange([...imageList, ...urls]);
    setIsUploading(false);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const btnH = compact ? "h-8 text-sm" : "";

  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <input
          type="file"
          ref={fileInputRef}
          onChange={handleFileChange}
          className="hidden"
          accept="image/*"
          multiple
        />
        <Button
          type="button"
          variant="outline"
          className={`flex-1 justify-start gap-2 ${btnH}`}
          onClick={() => fileInputRef.current?.click()}
          disabled={isUploading}
          title="Upload image(s)"
        >
          {isUploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <UploadCloud className="h-3.5 w-3.5" />}
          {isUploading ? "Uploading..." : "Upload image(s)"}
        </Button>
      </div>

      {imageList.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {imageList.map((img, i) => (
            <div key={i} className="relative group">
              <img
                src={img}
                alt={`gallery ${i + 1}`}
                className="h-16 w-16 object-cover rounded border"
                onError={(e) => {
                  const el = e.target as HTMLImageElement;
                  el.style.display = "none";
                  const fb = el.nextElementSibling as HTMLElement | null;
                  if (fb) fb.style.display = "flex";
                }}
              />
              <div
                className="h-16 w-16 rounded border bg-muted items-center justify-center text-xs text-muted-foreground hidden"
                title={img}
              >
                IMG
              </div>
              <button
                type="button"
                onClick={() => onChange(imageList.filter((_, j) => j !== i))}
                className="absolute -top-1.5 -right-1.5 bg-destructive text-destructive-foreground rounded-full h-4 w-4 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
              >
                <X className="h-2.5 w-2.5" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
