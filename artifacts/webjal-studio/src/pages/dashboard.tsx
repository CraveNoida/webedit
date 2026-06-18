import { useGetDashboardStats } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { FileCode, Briefcase, Plus, ArrowRight } from "lucide-react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { format } from "date-fns";
import { BarChart, Bar, XAxis, YAxis, Tooltip as RechartsTooltip, ResponsiveContainer, Cell } from "recharts";

export default function Dashboard() {
  const { data: stats, isLoading, isError } = useGetDashboardStats();

  if (isLoading) {
    return (
      <div className="p-8 space-y-6">
        <Skeleton className="h-8 w-48" />
        <div className="grid gap-4 md:grid-cols-3">
          <Skeleton className="h-32" />
          <Skeleton className="h-32" />
          <Skeleton className="h-32" />
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          <Skeleton className="h-[400px]" />
          <Skeleton className="h-[400px]" />
        </div>
      </div>
    );
  }

  if (isError || !stats) {
    return (
      <div className="flex-1 bg-gray-50/50 p-8">
        <Card className="max-w-xl border-red-200 bg-white shadow-sm">
          <CardHeader>
            <CardTitle className="text-lg text-red-700">Backend connection failed</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm text-muted-foreground">
            <p>The frontend loaded, but it could not reach the API server.</p>
            <p>
              In Cloudflare Pages, set <code className="font-mono">VITE_API_BASE_URL</code> to your Render backend URL,
              then redeploy the frontend.
            </p>
            <p>
              In Render, set <code className="font-mono">CORS_ORIGIN</code> to this Cloudflare Pages URL.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="p-8 space-y-8 flex-1 overflow-auto bg-gray-50/50 dark:bg-background">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-foreground">Dashboard</h1>
          <p className="text-muted-foreground mt-1">Welcome back. Here is the overview of your studio.</p>
        </div>
        <Link href="/projects/new">
          <Button className="bg-gradient-to-r from-primary to-purple-600 hover:from-primary/90 hover:to-purple-600/90 shadow-md">
            <Plus className="mr-2 h-4 w-4" /> Create New Demo
          </Button>
        </Link>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Card className="shadow-sm border-0 bg-white dark:bg-card">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Total Projects</CardTitle>
            <div className="h-8 w-8 rounded-full bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center">
              <Briefcase className="h-4 w-4 text-blue-600 dark:text-blue-400" />
            </div>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">{stats.totalProjects}</div>
          </CardContent>
        </Card>
        
        <Card className="shadow-sm border-0 bg-white dark:bg-card">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Total Templates</CardTitle>
            <div className="h-8 w-8 rounded-full bg-purple-100 dark:bg-purple-900/30 flex items-center justify-center">
              <FileCode className="h-4 w-4 text-purple-600 dark:text-purple-400" />
            </div>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">{stats.totalTemplates}</div>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        <Card className="shadow-sm border-0 flex flex-col">
          <CardHeader className="border-b bg-gray-50/50 dark:bg-transparent pb-4">
            <div className="flex items-center justify-between">
              <CardTitle className="text-lg">Recent Projects</CardTitle>
              <Link href="/projects">
                <Button variant="ghost" size="sm" className="text-xs">
                  View All <ArrowRight className="ml-1 h-3 w-3" />
                </Button>
              </Link>
            </div>
          </CardHeader>
          <CardContent className="p-0 flex-1">
            {stats.recentProjects.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-center">
                <div className="h-12 w-12 rounded-full bg-muted flex items-center justify-center mb-4">
                  <Briefcase className="h-6 w-6 text-muted-foreground" />
                </div>
                <h3 className="text-lg font-medium">No projects yet</h3>
                <p className="text-sm text-muted-foreground mb-4 max-w-xs">Create your first demo project to see it here.</p>
                <Link href="/projects/new">
                  <Button variant="outline">Create Project</Button>
                </Link>
              </div>
            ) : (
              <div className="divide-y">
                {stats.recentProjects.map((project) => (
                  <div key={project.id} className="flex items-center justify-between p-4 hover:bg-gray-50 dark:hover:bg-muted/50 transition-colors">
                    <div className="space-y-1">
                      <Link href={`/projects/${project.id}`}>
                        <span className="font-medium hover:underline cursor-pointer">{project.businessName}</span>
                      </Link>
                      <div className="flex items-center text-xs text-muted-foreground gap-2">
                        <Badge variant="secondary" className="font-normal text-[10px] px-1.5 py-0">
                          {project.category}
                        </Badge>
                        <span>•</span>
                        <span>{format(new Date(project.createdAt), "MMM d, yyyy")}</span>
                      </div>
                    </div>
                    <Badge variant={project.status === "draft" ? "outline" : "default"}>
                      {project.status}
                    </Badge>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="shadow-sm border-0">
          <CardHeader className="border-b bg-gray-50/50 dark:bg-transparent pb-4">
            <CardTitle className="text-lg">Projects by Category</CardTitle>
          </CardHeader>
          <CardContent className="pt-6">
            {stats.projectsByCategory.length === 0 ? (
              <div className="flex h-[250px] items-center justify-center text-sm text-muted-foreground">
                No data available
              </div>
            ) : (
              <div className="h-[250px] w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={stats.projectsByCategory} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                    <XAxis dataKey="category" fontSize={12} tickLine={false} axisLine={false} />
                    <YAxis fontSize={12} tickLine={false} axisLine={false} allowDecimals={false} />
                    <RechartsTooltip 
                      cursor={{ fill: 'var(--color-muted)' }}
                      contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: 'var(--shadow-sm)' }}
                    />
                    <Bar dataKey="count" radius={[4, 4, 0, 0]}>
                      {stats.projectsByCategory.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={`var(--color-chart-${(index % 5) + 1})`} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
