import { useState, useEffect, useRef } from "react";
import { useParams, useLocation } from "wouter";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import {
  useGetProject,
  useUpdateProject,
  useGenerateProject,
  useDuplicateProject,
  useDeleteProject,
  getGetProjectQueryKey,
  getListProjectsQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Form, FormControl, FormField, FormItem, FormLabel } from "@/components/ui/form";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import {
  ArrowLeft, Monitor, Tablet, Smartphone, RefreshCw, Download, Copy, Trash2, Loader2, Plus, X, Pencil, Eye
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { CATEGORIES } from "@/lib/constants";
import { FileUpload, GalleryUpload } from "@/components/file-upload";
import { EDITOR_SCRIPT } from "@/lib/editor-script";
import { apiUrl } from "@/lib/api-url";

const formSchema = z.object({
  businessName: z.string().min(1),
  category: z.string().min(1),
  tagline: z.string().optional(),
  about: z.string().optional(),
  phone: z.string().optional(),
  whatsapp: z.string().optional(),
  email: z.string().optional(),
  address: z.string().optional(),
  googleMapsLink: z.string().optional(),
  instagramLink: z.string().optional(),
  ctaText: z.string().optional(),
  primaryColor: z.string().optional(),
  secondaryColor: z.string().optional(),
  logoUrl: z.string().optional(),
  heroImageUrl: z.string().optional(),
});

type FormValues = z.infer<typeof formSchema>;

type ViewMode = "desktop" | "tablet" | "mobile";

const VIEW_WIDTHS: Record<ViewMode, string> = {
  desktop: "100%",
  tablet: "768px",
  mobile: "375px",
};

export default function ProjectWorkspace() {
  const { id } = useParams<{ id: string }>();
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const [viewMode, setViewMode] = useState<ViewMode>("desktop");
  const [services, setServices] = useState<string[]>([]);
  const [newService, setNewService] = useState("");
  const [galleryImages, setGalleryImages] = useState<string[]>([]);
  const [previewBlobUrl, setPreviewBlobUrl] = useState<string | null>(null);
  const [isEditMode, setIsEditMode] = useState(false);
  const [editSaveStatus, setEditSaveStatus] = useState<"idle" | "saving" | "saved">("idle");
  const editedHtmlRef = useRef<string | null>(null);
  const isEditModeRef = useRef(false);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  const { data: project, isLoading } = useGetProject(
    Number(id),
    { query: { enabled: !!id, queryKey: getGetProjectQueryKey(Number(id)) } }
  );

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      businessName: "",
      category: "",
      tagline: "",
      about: "",
      phone: "",
      whatsapp: "",
      email: "",
      address: "",
      googleMapsLink: "",
      instagramLink: "",
      ctaText: "Get In Touch",
      primaryColor: "#4f46e5",
      secondaryColor: "#7c3aed",
      logoUrl: "",
      heroImageUrl: "",
    },
  });

  useEffect(() => {
    if (project) {
      form.reset({
        businessName: project.businessName,
        category: project.category,
        tagline: project.tagline ?? "",
        about: project.about ?? "",
        phone: project.phone ?? "",
        whatsapp: project.whatsapp ?? "",
        email: project.email ?? "",
        address: project.address ?? "",
        googleMapsLink: project.googleMapsLink ?? "",
        instagramLink: project.instagramLink ?? "",
        ctaText: project.ctaText ?? "Get In Touch",
        primaryColor: project.primaryColor ?? "#4f46e5",
        secondaryColor: project.secondaryColor ?? "#7c3aed",
        logoUrl: project.logoUrl ?? "",
        heroImageUrl: project.heroImageUrl ?? "",
      });
      setServices(Array.isArray(project.services) ? project.services : []);
      setGalleryImages(Array.isArray(project.galleryImages) ? project.galleryImages : []);
    }
  }, [project]);

  useEffect(() => {
    if (project?.generatedHtml && !isEditModeRef.current) {
      const blob = new Blob([project.generatedHtml], { type: "text/html" });
      const url = URL.createObjectURL(blob);
      setPreviewBlobUrl((prev) => { if (prev) URL.revokeObjectURL(prev); return url; });
      return () => URL.revokeObjectURL(url);
    }
    return undefined;
  }, [project?.generatedHtml]);

  // Sync edit mode ref
  useEffect(() => { isEditModeRef.current = isEditMode; }, [isEditMode]);

  // postMessage listener from the editor iframe
  useEffect(() => {
    function handleMessage(e: MessageEvent) {
      if (e.data?.type === "wj-html-change") {
        const html = e.data.html as string;
        editedHtmlRef.current = html;
        setEditSaveStatus("saving");
        // Save to backend
        fetch(apiUrl(`/api/projects/${id}/html`), {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ html }),
        })
          .then((r) => r.json())
          .then((updated) => {
            queryClient.setQueryData(getGetProjectQueryKey(Number(id)), updated);
            setEditSaveStatus("saved");
            setTimeout(() => setEditSaveStatus("idle"), 2000);
          })
          .catch(() => setEditSaveStatus("idle"));
      }
      if (e.data?.type === "wj-exit-edit") {
        exitEditMode();
      }
    }
    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, [id]);

  function buildEditBlob(html: string): string {
    const withEditor = html.replace("</body>", `${EDITOR_SCRIPT}\n</body>`);
    const blob = new Blob([withEditor], { type: "text/html" });
    return URL.createObjectURL(blob);
  }

  function enterEditMode() {
    const html = editedHtmlRef.current ?? project?.generatedHtml;
    if (!html) { toast({ title: "Generate the website first before editing." }); return; }
    setIsEditMode(true);
    const url = buildEditBlob(html);
    setPreviewBlobUrl((prev) => { if (prev) URL.revokeObjectURL(prev); return url; });
  }

  function exitEditMode() {
    setIsEditMode(false);
    setEditSaveStatus("idle");
    const html = editedHtmlRef.current ?? project?.generatedHtml;
    if (!html) return;
    const blob = new Blob([html], { type: "text/html" });
    const url = URL.createObjectURL(blob);
    setPreviewBlobUrl((prev) => { if (prev) URL.revokeObjectURL(prev); return url; });
  }

  const updateMutation = useUpdateProject({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getGetProjectQueryKey(Number(id)) });
        toast({ title: "Project saved" });
      },
      onError: () => toast({ title: "Failed to save", variant: "destructive" }),
    },
  });

  const generateMutation = useGenerateProject({
    mutation: {
      onSuccess: (data) => {
        // Clear any manual edits — generate always starts fresh
        editedHtmlRef.current = null;
        setIsEditMode(false);
        setEditSaveStatus("idle");
        queryClient.setQueryData(getGetProjectQueryKey(Number(id)), data);
        if (data.generatedHtml) {
          const blob = new Blob([data.generatedHtml], { type: "text/html" });
          const url = URL.createObjectURL(blob);
          setPreviewBlobUrl((prev) => { if (prev) URL.revokeObjectURL(prev); return url; });
        }
        toast({ title: "Website generated successfully" });
      },
      onError: () => toast({ title: "Failed to generate website", variant: "destructive" }),
    },
  });

  const duplicateMutation = useDuplicateProject({
    mutation: {
      onSuccess: (newProject) => {
        queryClient.invalidateQueries({ queryKey: getListProjectsQueryKey() });
        toast({ title: "Project duplicated" });
        setLocation(`/projects/${newProject.id}`);
      },
    },
  });

  const deleteMutation = useDeleteProject({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListProjectsQueryKey() });
        setLocation("/projects");
        toast({ title: "Project deleted" });
      },
    },
  });

  async function handleSave() {
    const values = form.getValues();
    await updateMutation.mutateAsync({
      id: Number(id),
      data: {
        ...values,
        services,
        galleryImages,
      },
    });
  }

  async function handleGenerate() {
    await handleSave();
    generateMutation.mutate({ id: Number(id) });
  }

  async function handleDownloadZip() {
    try {
      const response = await fetch(apiUrl(`/api/projects/${id}/download-zip`));
      if (!response.ok) {
        const err = await response.json();
        toast({ title: err.error ?? "Download failed", variant: "destructive" });
        return;
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${project?.businessName?.toLowerCase().replace(/[^a-z0-9]+/g, "-") ?? "demo"}-demo.zip`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch {
      toast({ title: "Download failed", variant: "destructive" });
    }
  }

  if (isLoading) {
    return (
      <div className="p-8 space-y-4">
        <Skeleton className="h-8 w-64" />
        <div className="grid grid-cols-2 gap-4 h-[600px]">
          <Skeleton className="h-full" />
          <Skeleton className="h-full" />
        </div>
      </div>
    );
  }

  if (!project) {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-muted-foreground">Project not found.</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-screen overflow-hidden">
      <div className="flex items-center justify-between px-6 py-3 border-b bg-background shrink-0 gap-4">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={() => setLocation("/projects")}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            <div className="font-semibold leading-tight">{project.businessName}</div>
            <div className="flex items-center gap-1.5 mt-0.5">
              <Badge variant="secondary" className="text-xs">{project.category}</Badge>
              <Badge variant={project.status === "generated" ? "default" : "outline"} className="text-xs">
                {project.status}
              </Badge>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <div className="flex items-center border rounded-md overflow-hidden">
            {(["desktop", "tablet", "mobile"] as ViewMode[]).map((mode) => {
              const Icon = mode === "desktop" ? Monitor : mode === "tablet" ? Tablet : Smartphone;
              return (
                <button
                  key={mode}
                  onClick={() => setViewMode(mode)}
                  data-testid={`button-view-${mode}`}
                  className={`p-2 transition-colors ${viewMode === mode ? "bg-primary text-primary-foreground" : "hover:bg-muted"}`}
                >
                  <Icon className="h-3.5 w-3.5" />
                </button>
              );
            })}
          </div>

          {/* Edit Mode toggle */}
          <Button
            variant={isEditMode ? "default" : "outline"}
            size="sm"
            onClick={isEditMode ? exitEditMode : enterEditMode}
            disabled={!project?.generatedHtml}
            data-testid="button-edit-mode"
            className={`gap-1.5 ${isEditMode ? "bg-purple-600 hover:bg-purple-700 border-purple-600" : ""}`}
          >
            {isEditMode ? <Eye className="h-3.5 w-3.5" /> : <Pencil className="h-3.5 w-3.5" />}
            {isEditMode ? "Preview" : "Edit"}
          </Button>

          {isEditMode && editSaveStatus !== "idle" && (
            <span className={`text-xs ${editSaveStatus === "saved" ? "text-green-600" : "text-muted-foreground"}`}>
              {editSaveStatus === "saving" ? "Saving..." : "Saved ✓"}
            </span>
          )}

          <Button
            variant="outline"
            size="sm"
            onClick={handleGenerate}
            disabled={generateMutation.isPending || updateMutation.isPending}
            data-testid="button-generate"
            className="gap-1.5"
          >
            {generateMutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
            Regenerate
          </Button>

          <Button
            size="sm"
            onClick={handleDownloadZip}
            disabled={!project.generatedHtml}
            data-testid="button-download-zip"
            className="gap-1.5 bg-gradient-to-r from-primary to-purple-600 hover:from-primary/90 hover:to-purple-600/90"
          >
            <Download className="h-3.5 w-3.5" />
            Download ZIP
          </Button>

          <Button variant="ghost" size="icon" onClick={() => duplicateMutation.mutate({ id: Number(id) })} data-testid="button-duplicate">
            <Copy className="h-4 w-4" />
          </Button>

          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="ghost" size="icon" className="text-destructive hover:text-destructive" data-testid="button-delete">
                <Trash2 className="h-4 w-4" />
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Delete project?</AlertDialogTitle>
                <AlertDialogDescription>This will permanently delete "{project.businessName}".</AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  className="bg-destructive text-destructive-foreground"
                  onClick={() => deleteMutation.mutate({ id: Number(id) })}
                >Delete</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </div>

      <div className="flex flex-1 overflow-hidden">
        <div className="w-80 lg:w-96 shrink-0 border-r flex flex-col overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b">
            <span className="text-sm font-medium">Client Details</span>
            <Button size="sm" variant="outline" onClick={handleSave} disabled={updateMutation.isPending} data-testid="button-save">
              {updateMutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : null}
              Save
            </Button>
          </div>
          <ScrollArea className="flex-1">
            <Form {...form}>
              <form className="px-4 py-4 space-y-4">
                <FormField control={form.control} name="businessName" render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-xs">Business Name</FormLabel>
                    <FormControl><Input {...field} className="h-8 text-sm" data-testid="input-business-name" /></FormControl>
                  </FormItem>
                )} />

                <FormField control={form.control} name="category" render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-xs">Category</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl>
                        <SelectTrigger className="h-8 text-sm">
                          <SelectValue />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {CATEGORIES.map((cat) => <SelectItem key={cat} value={cat}>{cat}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </FormItem>
                )} />

                <FormField control={form.control} name="tagline" render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-xs">Tagline</FormLabel>
                    <FormControl><Input {...field} className="h-8 text-sm" placeholder="Your transformation, our passion" data-testid="input-tagline" /></FormControl>
                  </FormItem>
                )} />

                <FormField control={form.control} name="about" render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-xs">About</FormLabel>
                    <FormControl><Textarea {...field} rows={3} className="text-sm resize-none" data-testid="textarea-about" /></FormControl>
                  </FormItem>
                )} />

                <Separator />

                <FormField control={form.control} name="phone" render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-xs">Phone</FormLabel>
                    <FormControl><Input {...field} className="h-8 text-sm" data-testid="input-phone" /></FormControl>
                  </FormItem>
                )} />

                <FormField control={form.control} name="whatsapp" render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-xs">WhatsApp</FormLabel>
                    <FormControl><Input {...field} className="h-8 text-sm" data-testid="input-whatsapp" /></FormControl>
                  </FormItem>
                )} />

                <FormField control={form.control} name="email" render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-xs">Email</FormLabel>
                    <FormControl><Input {...field} className="h-8 text-sm" data-testid="input-email" /></FormControl>
                  </FormItem>
                )} />

                <FormField control={form.control} name="address" render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-xs">Address</FormLabel>
                    <FormControl><Input {...field} className="h-8 text-sm" data-testid="input-address" /></FormControl>
                  </FormItem>
                )} />

                <FormField control={form.control} name="googleMapsLink" render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-xs">Google Maps Link</FormLabel>
                    <FormControl><Input {...field} className="h-8 text-sm" data-testid="input-maps" /></FormControl>
                  </FormItem>
                )} />

                <FormField control={form.control} name="instagramLink" render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-xs">Instagram Link</FormLabel>
                    <FormControl><Input {...field} className="h-8 text-sm" data-testid="input-instagram" /></FormControl>
                  </FormItem>
                )} />

                <Separator />

                <div>
                  <p className="text-xs font-medium mb-2">Services</p>
                  <div className="flex gap-2 mb-2">
                    <Input
                      value={newService}
                      onChange={(e) => setNewService(e.target.value)}
                      placeholder="Add service..."
                      className="h-8 text-sm"
                      data-testid="input-new-service"
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          if (newService.trim()) {
                            setServices([...services, newService.trim()]);
                            setNewService("");
                          }
                        }
                      }}
                    />
                    <Button type="button" variant="outline" size="icon" className="h-8 w-8 shrink-0"
                      onClick={() => { if (newService.trim()) { setServices([...services, newService.trim()]); setNewService(""); } }}>
                      <Plus className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {services.map((s, i) => (
                      <Badge key={i} variant="secondary" className="text-xs gap-1">
                        {s}
                        <button type="button" onClick={() => setServices(services.filter((_, j) => j !== i))}>
                          <X className="h-3 w-3" />
                        </button>
                      </Badge>
                    ))}
                  </div>
                </div>

                <Separator />

                <FormField control={form.control} name="ctaText" render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-xs">CTA Button Text</FormLabel>
                    <FormControl><Input {...field} className="h-8 text-sm" placeholder="Get In Touch" data-testid="input-cta" /></FormControl>
                  </FormItem>
                )} />

                <div className="grid grid-cols-2 gap-3">
                  <FormField control={form.control} name="primaryColor" render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-xs">Primary Color</FormLabel>
                      <FormControl>
                        <div className="flex items-center gap-1.5">
                          <input type="color" value={field.value} onChange={field.onChange} className="h-8 w-8 rounded border cursor-pointer" data-testid="input-primary-color" />
                          <Input value={field.value} onChange={field.onChange} className="h-8 text-xs font-mono" />
                        </div>
                      </FormControl>
                    </FormItem>
                  )} />
                  <FormField control={form.control} name="secondaryColor" render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-xs">Secondary Color</FormLabel>
                      <FormControl>
                        <div className="flex items-center gap-1.5">
                          <input type="color" value={field.value} onChange={field.onChange} className="h-8 w-8 rounded border cursor-pointer" data-testid="input-secondary-color" />
                          <Input value={field.value} onChange={field.onChange} className="h-8 text-xs font-mono" />
                        </div>
                      </FormControl>
                    </FormItem>
                  )} />
                </div>

                <FormField control={form.control} name="logoUrl" render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-xs">Logo</FormLabel>
                    <FormControl>
                      <FileUpload value={field.value ?? ""} onChange={field.onChange} placeholder="Logo URL..." />
                    </FormControl>
                  </FormItem>
                )} />

                <FormField control={form.control} name="heroImageUrl" render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-xs">Hero Image</FormLabel>
                    <FormControl>
                      <FileUpload value={field.value ?? ""} onChange={field.onChange} placeholder="Hero image URL..." />
                    </FormControl>
                  </FormItem>
                )} />

                <div>
                  <p className="text-xs font-medium mb-2">Gallery Images</p>
                  <GalleryUpload images={galleryImages} onChange={setGalleryImages} compact />
                </div>
              </form>
            </Form>
          </ScrollArea>
        </div>

        <div className="flex-1 flex flex-col bg-muted/30 overflow-hidden">
          <div className="flex-1 flex items-start justify-center overflow-auto p-4">
            <div
              style={{ width: VIEW_WIDTHS[viewMode], maxWidth: "100%", minHeight: "100%" }}
              className="transition-all duration-300 bg-white rounded-md shadow-lg overflow-hidden"
            >
              {previewBlobUrl ? (
                <iframe
                  ref={iframeRef}
                  src={previewBlobUrl}
                  className="w-full border-0"
                  style={{ height: "calc(100vh - 120px)" }}
                  title="Website Preview"
                  data-testid="iframe-preview"
                />
              ) : (
                <div className="flex flex-col items-center justify-center h-[600px] text-center p-8">
                  <div className="h-16 w-16 rounded-2xl bg-primary/10 flex items-center justify-center mb-4">
                    <RefreshCw className="h-8 w-8 text-primary/50" />
                  </div>
                  <h3 className="text-lg font-semibold mb-2">No preview yet</h3>
                  <p className="text-muted-foreground text-sm mb-4 max-w-xs">
                    {project.templateId
                      ? "Click Regenerate to generate the website preview from your template."
                      : "Select a template first, then click Regenerate to generate the preview."}
                  </p>
                  <Button onClick={handleGenerate} disabled={!project.templateId || generateMutation.isPending} className="gap-2" data-testid="button-generate-from-empty">
                    {generateMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                    Generate Preview
                  </Button>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
