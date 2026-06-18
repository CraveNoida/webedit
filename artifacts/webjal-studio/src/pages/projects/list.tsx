import { useState } from "react";
import { Link } from "wouter";
import { useListProjects, useDeleteProject, useDuplicateProject, getListProjectsQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Plus, Search, MoreVertical, Trash2, Copy, ExternalLink, Briefcase } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { CATEGORIES } from "@/lib/constants";
import { format } from "date-fns";

export default function ProjectsList() {
  const [category, setCategory] = useState("all");
  const [search, setSearch] = useState("");
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const params = category && category !== "all" ? { category, search: search || undefined } : { search: search || undefined };
  const { data: projects, isLoading } = useListProjects(params);
  const projectList = Array.isArray(projects) ? projects : [];

  const deleteMutation = useDeleteProject({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListProjectsQueryKey() });
        toast({ title: "Project deleted" });
      },
      onError: () => toast({ title: "Failed to delete", variant: "destructive" }),
    },
  });

  const duplicateMutation = useDuplicateProject({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListProjectsQueryKey() });
        toast({ title: "Project duplicated" });
      },
      onError: () => toast({ title: "Failed to duplicate", variant: "destructive" }),
    },
  });

  const statusColor: Record<string, string> = {
    draft: "secondary",
    generated: "default",
  };

  return (
    <div className="p-8 space-y-6 flex-1 overflow-auto">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Client Projects</h1>
          <p className="text-muted-foreground mt-1">All your client demo projects</p>
        </div>
        <Link href="/projects/new">
          <Button className="bg-gradient-to-r from-primary to-purple-600 hover:from-primary/90 hover:to-purple-600/90 shadow-md gap-2" data-testid="button-new-project">
            <Plus className="h-4 w-4" /> New Demo
          </Button>
        </Link>
      </div>

      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by business name..."
            className="pl-9"
            data-testid="input-search-projects"
          />
        </div>
        <Select value={category} onValueChange={setCategory}>
          <SelectTrigger className="w-[180px]" data-testid="select-category">
            <SelectValue placeholder="All categories" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All categories</SelectItem>
            {CATEGORIES.map((cat) => (
              <SelectItem key={cat} value={cat}>{cat}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        {projects && (
          <span className="text-sm text-muted-foreground">{projectList.length} project{projectList.length !== 1 ? "s" : ""}</span>
        )}
      </div>

      {isLoading ? (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-44" />
          ))}
        </div>
      ) : projectList.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-24 text-center">
          <div className="h-16 w-16 rounded-2xl bg-muted flex items-center justify-center mb-4">
            <Briefcase className="h-8 w-8 text-muted-foreground" />
          </div>
          <h3 className="text-xl font-semibold mb-2">No projects yet</h3>
          <p className="text-muted-foreground mb-6 max-w-sm">
            Create your first client demo project. Select a template, fill in the client's details, and generate an instant preview.
          </p>
          <Link href="/projects/new">
            <Button>Create your first project</Button>
          </Link>
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {projectList.map((project) => (
            <Card key={project.id} data-testid={`card-project-${project.id}`} className="group border shadow-sm hover:shadow-md transition-shadow">
              <CardHeader className="pb-2">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <CardTitle className="text-base leading-tight">{project.businessName}</CardTitle>
                    {project.tagline && (
                      <CardDescription className="text-xs mt-0.5 line-clamp-1">{project.tagline}</CardDescription>
                    )}
                  </div>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity" data-testid={`button-project-menu-${project.id}`}>
                        <MoreVertical className="h-4 w-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem asChild>
                        <Link href={`/projects/${project.id}`}>
                          <ExternalLink className="h-4 w-4 mr-2" /> Open
                        </Link>
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => duplicateMutation.mutate({ id: project.id })}>
                        <Copy className="h-4 w-4 mr-2" /> Duplicate
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex flex-wrap gap-1.5">
                  <Badge variant="secondary" className="text-xs">{project.category}</Badge>
                  <Badge variant={project.status === "generated" ? "default" : "outline"} className="text-xs">
                    {project.status}
                  </Badge>
                </div>
                <div className="text-xs text-muted-foreground">
                  Updated {format(new Date(project.updatedAt), "MMM d, yyyy")}
                </div>
                <div className="flex items-center gap-2 pt-1">
                  <Link href={`/projects/${project.id}`} className="flex-1">
                    <Button variant="outline" size="sm" className="w-full text-xs" data-testid={`button-open-project-${project.id}`}>
                      Open Workspace
                    </Button>
                  </Link>
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive hover:text-destructive shrink-0" data-testid={`button-delete-project-${project.id}`}>
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Delete project?</AlertDialogTitle>
                        <AlertDialogDescription>
                          This will permanently delete the demo for "{project.businessName}".
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction
                          className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                          onClick={() => deleteMutation.mutate({ id: project.id })}
                        >
                          Delete
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
