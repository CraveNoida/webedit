import { Link, useLocation } from "wouter";
import { LayoutDashboard, FileCode, Briefcase, Plus, Menu } from "lucide-react";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { useState } from "react";

interface SidebarProps {
  className?: string;
  onNavigate?: () => void;
}

function Sidebar({ className, onNavigate }: SidebarProps) {
  const [location] = useLocation();

  const links = [
    { href: "/", label: "Dashboard", icon: LayoutDashboard },
    { href: "/projects", label: "Projects", icon: Briefcase },
    { href: "/templates", label: "Templates", icon: FileCode },
  ];

  return (
    <div className={`flex h-full flex-col bg-sidebar text-sidebar-foreground ${className}`}>
      <div className="flex h-14 items-center px-4 font-bold tracking-tight text-xl bg-sidebar border-b border-sidebar-border shadow-sm">
        <div className="w-8 h-8 rounded bg-gradient-to-tr from-primary to-purple-500 mr-2 flex items-center justify-center text-white">
          W
        </div>
        Webjal
      </div>
      <div className="flex-1 overflow-auto py-4">
        <nav className="grid gap-1 px-2">
          {links.map((link) => {
            const isActive = location === link.href || (link.href !== "/" && location.startsWith(link.href));
            return (
              <Link key={link.href} href={link.href} onClick={onNavigate}>
                <div
                  className={`flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground ${
                    isActive ? "bg-sidebar-accent text-sidebar-accent-foreground" : "text-sidebar-foreground/70"
                  }`}
                >
                  <link.icon className="h-4 w-4" />
                  {link.label}
                </div>
              </Link>
            );
          })}
        </nav>
      </div>
      <div className="p-4 mt-auto border-t border-sidebar-border">
        <Link href="/projects/new" onClick={onNavigate}>
          <Button className="w-full bg-primary hover:bg-primary/90 text-primary-foreground shadow-md gap-2">
            <Plus className="h-4 w-4" />
            New Demo
          </Button>
        </Link>
      </div>
    </div>
  );
}

export function AppLayout({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="flex min-h-screen w-full flex-col bg-background md:flex-row">
      {/* Mobile sidebar */}
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetTrigger asChild>
          <Button variant="outline" size="icon" className="shrink-0 md:hidden absolute top-3 left-4 z-40">
            <Menu className="h-5 w-5" />
            <span className="sr-only">Toggle navigation menu</span>
          </Button>
        </SheetTrigger>
        <SheetContent side="left" className="p-0 w-64 bg-sidebar border-sidebar-border">
          <Sidebar onNavigate={() => setOpen(false)} />
        </SheetContent>
      </Sheet>

      {/* Desktop sidebar */}
      <div className="hidden border-r border-sidebar-border bg-sidebar md:block md:w-64 lg:w-72 shrink-0">
        <Sidebar />
      </div>

      <main className="flex-1 flex flex-col min-w-0 overflow-hidden relative">
        {children}
      </main>
    </div>
  );
}
