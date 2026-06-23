import React, { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { UploadCloud, Loader2, Plus, X } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiUrl } from "@/lib/api-url";

interface FileUploadProps {
  value: string;
  onChange: (url: string) => void;
  placeholder?: string;
  className?: string;
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
    toast({ title: "Image upload failed", variant: "destructive" });
    return null;
  }
}

export function FileUpload({ value, onChange, placeholder = "Image URL...", className }: FileUploadProps) {
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
      <Input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="flex-1"
      />
      <input type="file" ref={fileInputRef} onChange={handleFileChange} className="hidden" accept="image/*" />
      <Button
        type="button"
        variant="outline"
        size="icon"
        onClick={() => fileInputRef.current?.click()}
        disabled={isUploading}
        title="Upload image"
      >
        {isUploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <UploadCloud className="h-4 w-4" />}
      </Button>
      {value && (
        <img
          src={value}
          alt="preview"
          className="h-8 w-8 rounded object-cover border shrink-0"
          onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
          onLoad={(e) => { (e.target as HTMLImageElement).style.display = "block"; }}
        />
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
  const [urlInput, setUrlInput] = useState("");
  const [isUploading, setIsUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();
  const imageList = Array.isArray(images) ? images : [];

  function addUrl() {
    const trimmed = urlInput.trim();
    if (trimmed) {
      onChange([...imageList, trimmed]);
      setUrlInput("");
    }
  }

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

  const inputH = compact ? "h-8 text-sm" : "";
  const btnSz = compact ? "h-8 w-8" : "h-9 w-9";

  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <Input
          value={urlInput}
          onChange={(e) => setUrlInput(e.target.value)}
          placeholder="Paste image URL..."
          className={`flex-1 ${inputH}`}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addUrl(); } }}
        />
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
          size="icon"
          className={btnSz}
          onClick={() => fileInputRef.current?.click()}
          disabled={isUploading}
          title="Upload image(s)"
        >
          {isUploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <UploadCloud className="h-3.5 w-3.5" />}
        </Button>
        <Button
          type="button"
          variant="outline"
          size="icon"
          className={btnSz}
          onClick={addUrl}
          disabled={!urlInput.trim()}
          title="Add URL"
        >
          <Plus className="h-3.5 w-3.5" />
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
