import { useEffect, useState } from "react";
import { useLocation, useParams } from "wouter";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import {
  useCreateTemplate,
  useGetTemplate,
  useUpdateTemplate,
  getListTemplatesQueryKey,
  getGetTemplateQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { ArrowLeft, Plus, X, Loader2, Wand2, CheckCircle2, AlertTriangle } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { CATEGORIES } from "@/lib/constants";
import { FileUpload } from "@/components/file-upload";
import { FolderImport, type FolderImportResult } from "@/components/folder-import";
import { apiUrl } from "@/lib/api-url";

const COMMON_PLACEHOLDERS = [
  "{{businessName}}", "{{tagline}}", "{{about}}", "{{phone}}", "{{whatsapp}}",
  "{{email}}", "{{address}}", "{{googleMapsLink}}", "{{instagramLink}}",
  "{{heroImage}}", "{{services}}", "{{galleryImages}}", "{{primaryColor}}",
  "{{secondaryColor}}", "{{logoUrl}}", "{{ctaText}}", "{{seoTitle}}", "{{metaDescription}}",
];

const formSchema = z.object({
  name: z.string().min(1, "Name is required"),
  category: z.string().min(1, "Category is required"),
  description: z.string().optional(),
  htmlContent: z.string().min(1, "HTML content is required"),
  cssContent: z.string().optional(),
  jsContent: z.string().optional(),
  thumbnailUrl: z.string().optional(),
});

type FormValues = z.infer<typeof formSchema>;

export default function TemplateEditor() {
  const { id } = useParams<{ id?: string }>();
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const isEditing = !!id;

  const [placeholders, setPlaceholders] = useState<string[]>([]);
  const [newPlaceholder, setNewPlaceholder] = useState("");
  const [isInjecting, setIsInjecting] = useState(false);
  const [detectedFields, setDetectedFields] = useState<Record<string, string> | null>(null);
  const [hasExternalCss, setHasExternalCss] = useState(false);
  const [importedHtmlFiles, setImportedHtmlFiles] = useState<string[]>([]);
  const [importedCssFiles, setImportedCssFiles] = useState<string[]>([]);
  const [importedJsFiles, setImportedJsFiles] = useState<string[]>([]);

  const { data: template, isLoading } = useGetTemplate(
    Number(id),
    { query: { enabled: isEditing, queryKey: getGetTemplateQueryKey(Number(id)) } }
  );

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      name: "",
      category: "",
      description: "",
      htmlContent: "",
      cssContent: "",
      jsContent: "",
      thumbnailUrl: "",
    },
  });

  useEffect(() => {
    if (template) {
      form.reset({
        name: template.name,
        category: template.category,
        description: template.description ?? "",
        htmlContent: template.htmlContent,
        cssContent: template.cssContent ?? "",
        jsContent: template.jsContent ?? "",
        thumbnailUrl: template.thumbnailUrl ?? "",
      });
      setPlaceholders(template.placeholders ?? []);
      // Warn if template references external local CSS files
      setHasExternalCss(/<link[^>]+href="(?!https?:\/\/)(?!\/\/)[^"]+\.css"/.test(template.htmlContent));
    }
  }, [template]);

  const createMutation = useCreateTemplate({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListTemplatesQueryKey() });
        toast({ title: "Template created successfully" });
        setLocation("/templates");
      },
      onError: () => toast({ title: "Failed to create template", variant: "destructive" }),
    },
  });

  const updateMutation = useUpdateTemplate({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListTemplatesQueryKey() });
        queryClient.invalidateQueries({ queryKey: getGetTemplateQueryKey(Number(id)) });
        toast({ title: "Template updated successfully" });
        setLocation("/templates");
      },
      onError: () => toast({ title: "Failed to update template", variant: "destructive" }),
    },
  });

  const isPending = createMutation.isPending || updateMutation.isPending;

  function onSubmit(values: FormValues) {
    const data = {
      ...values,
      placeholders,
      description: values.description || undefined,
      cssContent: values.cssContent || undefined,
      jsContent: values.jsContent || undefined,
      thumbnailUrl: values.thumbnailUrl || undefined,
    };

    if (isEditing) {
      updateMutation.mutate({ id: Number(id), data });
    } else {
      createMutation.mutate({ data });
    }
  }

  function handleFolderImport({ html, css, js, mergedHtmlFiles, mergedCssFiles, mergedJsFiles }: FolderImportResult) {
    form.setValue("htmlContent", html, { shouldDirty: true });
    form.setValue("cssContent", css, { shouldDirty: true });
    form.setValue("jsContent", js, { shouldDirty: true });
    setHasExternalCss(/<link[^>]+href="(?!https?:\/\/|\/\/)([^"']+\.css)"/.test(html));
    setImportedHtmlFiles(mergedHtmlFiles);
    setImportedCssFiles(mergedCssFiles);
    setImportedJsFiles(mergedJsFiles);
  }

  async function handleInject() {
    if (!id) return;
    setIsInjecting(true);
    try {
      const res = await fetch(apiUrl(`/api/templates/${id}/inject`), { method: "POST" });
      if (!res.ok) throw new Error("Injection failed");
      const { template: updated, detected } = await res.json();
      // Refresh form with injected HTML
      form.setValue("htmlContent", updated.htmlContent);
      setPlaceholders(updated.placeholders ?? []);
      setDetectedFields(detected);
      setHasExternalCss(/<link[^>]+href="(?!https?:\/\/)(?!\/\/)[^"]+\.css"/.test(updated.htmlContent));
      queryClient.invalidateQueries({ queryKey: getGetTemplateQueryKey(Number(id)) });
      toast({ title: "Placeholders injected successfully" });
    } catch {
      toast({ title: "Auto-inject failed", variant: "destructive" });
    } finally {
      setIsInjecting(false);
    }
  }

  function addPlaceholder(p: string) {
    if (p && !placeholders.includes(p)) {
      setPlaceholders([...placeholders, p]);
    }
    setNewPlaceholder("");
  }

  if (isEditing && isLoading) {
    return (
      <div className="p-8 space-y-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-96" />
      </div>
    );
  }

  return (
    <div className="p-8 space-y-6 flex-1 overflow-auto">
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" onClick={() => setLocation("/templates")}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div className="flex-1">
          <h1 className="text-2xl font-bold tracking-tight">{isEditing ? "Edit Template" : "New Template"}</h1>
          <p className="text-muted-foreground text-sm mt-0.5">
            {isEditing ? "Update your template" : "Create a reusable website template with placeholder variables"}
          </p>
        </div>
        {isEditing && (
          <Button
            type="button"
            variant="outline"
            onClick={handleInject}
            disabled={isInjecting}
            className="gap-2 border-purple-400 text-purple-700 hover:bg-purple-50 dark:text-purple-300 dark:hover:bg-purple-900/20"
            data-testid="button-auto-inject"
          >
            {isInjecting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Wand2 className="h-4 w-4" />}
            Auto-detect Placeholders
          </Button>
        )}
      </div>

      {hasExternalCss && (
        <Alert className="border-amber-300 bg-amber-50 dark:bg-amber-900/20">
          <AlertTriangle className="h-4 w-4 text-amber-600" />
          <AlertDescription className="text-amber-800 dark:text-amber-200 text-sm">
            This template references an external <code className="font-mono text-xs">style.css</code> file. For the preview to look correct, paste your CSS into the <strong>CSS</strong> field below. Otherwise the site will appear unstyled.
          </AlertDescription>
        </Alert>
      )}

      {detectedFields && Object.keys(detectedFields).length > 0 && (
        <Alert className="border-green-300 bg-green-50 dark:bg-green-900/20">
          <CheckCircle2 className="h-4 w-4 text-green-600" />
          <AlertDescription className="text-green-800 dark:text-green-200 text-sm space-y-1">
            <p className="font-medium">Auto-detected and replaced the following hardcoded values:</p>
            <div className="flex flex-wrap gap-2 mt-1">
              {Object.entries(detectedFields).map(([key, val]) => (
                <span key={key} className="inline-flex items-center gap-1 bg-green-100 dark:bg-green-800/40 px-2 py-0.5 rounded text-xs font-mono">
                  <span className="text-green-600 dark:text-green-400">{"{{" + key + "}}"}</span>
                  <span className="text-muted-foreground">←</span>
                  <span className="truncate max-w-[160px]">{val}</span>
                </span>
              ))}
            </div>
            <p className="text-xs mt-1 text-green-700 dark:text-green-300">Now create a project with this template and fill in your client's details.</p>
          </AlertDescription>
        </Alert>
      )}

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            Import from Folder
            <span className="text-xs font-normal text-muted-foreground bg-muted px-2 py-0.5 rounded-full">recommended</span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <FolderImport onImport={handleFolderImport} />
        </CardContent>
      </Card>

      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
          <div className="grid gap-6 lg:grid-cols-3">
            <div className="lg:col-span-2 space-y-6">
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Basic Info</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid gap-4 sm:grid-cols-2">
                    <FormField
                      control={form.control}
                      name="name"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Template Name</FormLabel>
                          <FormControl>
                            <Input placeholder="e.g. Modern Salon" {...field} data-testid="input-template-name" />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="category"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Category</FormLabel>
                          <Select onValueChange={field.onChange} value={field.value}>
                            <FormControl>
                              <SelectTrigger data-testid="select-template-category">
                                <SelectValue placeholder="Select category" />
                              </SelectTrigger>
                            </FormControl>
                            <SelectContent>
                              {CATEGORIES.map((cat) => (
                                <SelectItem key={cat} value={cat}>{cat}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>
                  <FormField
                    control={form.control}
                    name="description"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Description</FormLabel>
                        <FormControl>
                          <Input placeholder="Short description of this template..." {...field} data-testid="input-template-description" />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="thumbnailUrl"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Thumbnail</FormLabel>
                        <FormControl>
                          <FileUpload value={field.value ?? ""} onChange={field.onChange} placeholder="Thumbnail image URL..." />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <div className="flex items-start justify-between gap-2">
                    <CardTitle className="text-base">HTML Content</CardTitle>
                    {importedHtmlFiles.length > 0 && (
                      <div className="flex flex-wrap gap-1 justify-end">
                        {importedHtmlFiles.map((f) => (
                          <span key={f} className="text-[10px] font-mono bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 px-2 py-0.5 rounded-full">{f}</span>
                        ))}
                      </div>
                    )}
                  </div>
                </CardHeader>
                <CardContent>
                  <FormField
                    control={form.control}
                    name="htmlContent"
                    render={({ field }) => (
                      <FormItem>
                        <FormControl>
                          <Textarea
                            {...field}
                            rows={18}
                            className="font-mono text-xs"
                            placeholder="Paste your HTML template here. Use {{businessName}}, {{primaryColor}}, etc. as placeholders."
                            data-testid="textarea-html-content"
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <div className="flex items-start justify-between gap-2">
                    <CardTitle className="text-base">CSS (optional)</CardTitle>
                    {importedCssFiles.length > 0 && (
                      <div className="flex flex-wrap gap-1 justify-end">
                        {importedCssFiles.map((f) => (
                          <span key={f} className="text-[10px] font-mono bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300 px-2 py-0.5 rounded-full">{f}</span>
                        ))}
                      </div>
                    )}
                  </div>
                </CardHeader>
                <CardContent>
                  <FormField
                    control={form.control}
                    name="cssContent"
                    render={({ field }) => (
                      <FormItem>
                        <FormControl>
                          <Textarea
                            {...field}
                            rows={10}
                            className="font-mono text-xs"
                            placeholder="Add CSS here — it will be injected into the generated HTML."
                            data-testid="textarea-css-content"
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <div className="flex items-start justify-between gap-2">
                    <CardTitle className="text-base">JavaScript (optional)</CardTitle>
                    {importedJsFiles.length > 0 && (
                      <div className="flex flex-wrap gap-1 justify-end">
                        {importedJsFiles.map((f) => (
                          <span key={f} className="text-[10px] font-mono bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300 px-2 py-0.5 rounded-full">{f}</span>
                        ))}
                      </div>
                    )}
                  </div>
                </CardHeader>
                <CardContent>
                  <FormField
                    control={form.control}
                    name="jsContent"
                    render={({ field }) => (
                      <FormItem>
                        <FormControl>
                          <Textarea
                            {...field}
                            rows={8}
                            className="font-mono text-xs"
                            placeholder="Add JavaScript here — it will be injected at the end of the body."
                            data-testid="textarea-js-content"
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </CardContent>
              </Card>
            </div>

            <div className="space-y-4">
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Placeholders</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <p className="text-xs text-muted-foreground">Declare which placeholders this template uses. These get replaced with client data when generating a demo.</p>
                  <div className="flex gap-2">
                    <Input
                      value={newPlaceholder}
                      onChange={(e) => setNewPlaceholder(e.target.value)}
                      placeholder="{{myPlaceholder}}"
                      className="text-xs font-mono"
                      data-testid="input-new-placeholder"
                      onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), addPlaceholder(newPlaceholder))}
                    />
                    <Button type="button" size="icon" variant="outline" onClick={() => addPlaceholder(newPlaceholder)}>
                      <Plus className="h-4 w-4" />
                    </Button>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {placeholders.map((p) => (
                      <Badge key={p} variant="secondary" className="font-mono text-xs gap-1">
                        {p}
                        <button type="button" onClick={() => setPlaceholders(placeholders.filter((x) => x !== p))}>
                          <X className="h-3 w-3" />
                        </button>
                      </Badge>
                    ))}
                  </div>
                  <div className="pt-2 border-t">
                    <p className="text-xs font-medium text-muted-foreground mb-2">Common placeholders</p>
                    <div className="flex flex-wrap gap-1">
                      {COMMON_PLACEHOLDERS.filter((p) => !placeholders.includes(p)).map((p) => (
                        <button
                          key={p}
                          type="button"
                          onClick={() => addPlaceholder(p)}
                          className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-muted hover:bg-primary/10 hover:text-primary transition-colors"
                        >
                          {p}
                        </button>
                      ))}
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Button type="submit" className="w-full" disabled={isPending} data-testid="button-save-template">
                {isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                {isEditing ? "Save Changes" : "Create Template"}
              </Button>
            </div>
          </div>
        </form>
      </Form>
    </div>
  );
}
