import { Component, type ErrorInfo, type ReactNode } from "react";
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

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: false,
    },
  },
});

class AppErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null; stack: string }> {
  state: { error: Error | null; stack: string } = { error: null, stack: "" };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("App render failed", error, info);
    this.setState({ stack: info.componentStack ?? "" });
  }

  render() {
    if (this.state.error) {
      return (
        <div className="min-h-screen bg-gray-50 p-8 text-gray-900">
          <div className="max-w-2xl rounded-lg border border-red-200 bg-white p-6 shadow-sm">
            <h1 className="text-xl font-semibold text-red-700">Frontend render failed</h1>
            <p className="mt-2 text-sm text-gray-600">
              The app loaded, but a browser runtime error stopped it from rendering.
            </p>
            <pre className="mt-4 overflow-auto rounded bg-gray-950 p-4 text-xs text-gray-100">
              {this.state.error.message}
            </pre>
            {this.state.stack && (
              <pre className="mt-3 max-h-80 overflow-auto rounded bg-gray-100 p-4 text-xs text-gray-700">
                {this.state.stack}
              </pre>
            )}
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

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
    <AppErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <TooltipProvider>
          <WouterRouter base={import.meta.env.BASE_URL?.replace(/\/$/, "") || ""}>
            <Router />
          </WouterRouter>
          <Toaster />
        </TooltipProvider>
      </QueryClientProvider>
    </AppErrorBoundary>
  );
}

export default App;
