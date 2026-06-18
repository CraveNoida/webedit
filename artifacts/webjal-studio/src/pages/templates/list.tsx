import { useState } from "react";
import { Link } from "wouter";
import { useListTemplates, useDeleteTemplate, getListTemplatesQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Plus, Pencil, Trash2, FileCode, Code2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { CATEGORIES } from "@/lib/constants";
import { format } from "date-fns";

export default function TemplatesList() {
  const [category, setCategory] = useState<string>("all");
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const params = category && category !== "all" ? { category } : undefined;
  const { data: templates, isLoading } = useListTemplates(params);
  const templateList = Array.isArray(templates) ? templates : [];
  const deleteMutation = useDeleteTemplate({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListTemplatesQueryKey() });
        toast({ title: "Template deleted" });
      },
      onError: () => toast({ title: "Failed to delete template", variant: "destructive" }),
    },
  });

  return (
    <div className="p-8 space-y-6 flex-1 overflow-auto">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Templates</h1>
          <p className="text-muted-foreground mt-1">Manage your reusable website templates</p>
        </div>
        <Link href="/templates/new">
          <Button className="bg-gradient-to-r from-primary to-purple-600 hover:from-primary/90 hover:to-purple-600/90 shadow-md gap-2">
            <Plus className="h-4 w-4" /> Add Template
          </Button>
        </Link>
      </div>

      <div className="flex items-center gap-3">
        <Select value={category} onValueChange={setCategory}>
          <SelectTrigger className="w-[200px]" data-testid="select-category-filter">
            <SelectValue placeholder="All categories" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All categories</SelectItem>
            {CATEGORIES.map((cat) => (
              <SelectItem key={cat} value={cat}>{cat}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        {templates && (
          <span className="text-sm text-muted-foreground">{templateList.length} template{templateList.length !== 1 ? "s" : ""}</span>
        )}
      </div>

      {isLoading ? (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-48" />
          ))}
        </div>
      ) : templateList.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-24 text-center">
          <div className="h-16 w-16 rounded-2xl bg-muted flex items-center justify-center mb-4">
            <FileCode className="h-8 w-8 text-muted-foreground" />
          </div>
          <h3 className="text-xl font-semibold mb-2">No templates yet</h3>
          <p className="text-muted-foreground mb-6 max-w-sm">
            Create your first template with HTML, CSS, and placeholders to start generating client demos instantly.
          </p>
          <Link href="/templates/new">
            <Button>Create your first template</Button>
          </Link>
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {templateList.map((template) => {
            const placeholders = Array.isArray(template.placeholders) ? template.placeholders : [];

            return (
              <Card key={template.id} data-testid={`card-template-${template.id}`} className="group border shadow-sm hover:shadow-md transition-shadow">
                {template.thumbnailUrl ? (
                  <div className="h-36 overflow-hidden rounded-t-lg bg-muted">
                    <img src={template.thumbnailUrl} alt={template.name} className="w-full h-full object-cover" />
                  </div>
                ) : (
                  <div className="h-36 rounded-t-lg bg-gradient-to-br from-primary/10 to-purple-600/10 flex items-center justify-center">
                    <Code2 className="h-10 w-10 text-primary/40" />
                  </div>
                )}
                <CardHeader className="pb-2">
                  <div className="flex items-start justify-between gap-2">
                    <CardTitle className="text-base leading-tight">{template.name}</CardTitle>
                    <Badge variant="secondary" className="shrink-0 text-xs">{template.category}</Badge>
                  </div>
                  {template.description && (
                    <CardDescription className="text-xs line-clamp-2">{template.description}</CardDescription>
                  )}
                </CardHeader>
                <CardContent className="pt-0">
                  <div className="flex items-center justify-between">
                    <div className="text-xs text-muted-foreground">
                      {placeholders.length} placeholder{placeholders.length !== 1 ? "s" : ""} - {format(new Date(template.createdAt), "MMM d, yyyy")}
                    </div>
                    <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      <Link href={`/templates/${template.id}/edit`}>
                        <Button variant="ghost" size="icon" className="h-7 w-7" data-testid={`button-edit-template-${template.id}`}>
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                      </Link>
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive hover:text-destructive" data-testid={`button-delete-template-${template.id}`}>
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>Delete template?</AlertDialogTitle>
                            <AlertDialogDescription>
                              This will permanently delete "{template.name}". Projects using this template won't be affected.
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>Cancel</AlertDialogCancel>
                            <AlertDialogAction
                              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                              onClick={() => deleteMutation.mutate({ id: template.id })}
                            >
                              Delete
                            </AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
