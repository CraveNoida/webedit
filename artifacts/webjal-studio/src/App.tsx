import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AppLayout } from "@/components/layout";
import NotFound from "@/pages/not-found";

import Dashboard from "@/pages/dashboard";
import TemplatesList from "@/pages/templates/list";
import TemplateEditor from "@/pages/templates/editor";
import ProjectsList from "@/pages/projects/list";
import ProjectNew from "@/pages/projects/new";
import ProjectWorkspace from "@/pages/projects/workspace";

const queryClient = new QueryClient();

function Router() {
  return (
    <AppLayout>
      <Switch>
        <Route path="/" component={Dashboard} />
        <Route path="/templates" component={TemplatesList} />
        <Route path="/templates/new" component={TemplateEditor} />
        <Route path="/templates/:id/edit" component={TemplateEditor} />
        <Route path="/projects" component={ProjectsList} />
        <Route path="/projects/new" component={ProjectNew} />
        <Route path="/projects/:id" component={ProjectWorkspace} />
        <Route component={NotFound} />
      </Switch>
    </AppLayout>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL?.replace(/\/$/, "") || ""}>
          <Router />
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
