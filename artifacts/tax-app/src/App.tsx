import { Switch, Route, Router as WouterRouter, Link, useLocation } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useParams } from "wouter";
import NotFound from "@/pages/not-found";
import Dashboard from "@/pages/Dashboard";
import ClientList from "@/pages/ClientList";
import ClientDetail from "@/pages/ClientDetail";
import ClientForm from "@/pages/ClientForm";
import { LayoutDashboard, Users, AlertTriangle, type LucideIcon } from "lucide-react";
import { BrandMark } from "@/components/BrandMark";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      staleTime: 30_000,
    },
  },
});

function NavLink({ href, label, icon: Icon, matchPrefix }: { href: string; label: string; icon: LucideIcon; matchPrefix?: boolean }) {
  const [location] = useLocation();
  const active = matchPrefix ? location.startsWith(href) : location === href;
  return (
    <Link href={href}>
      <div
        className={`group flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium cursor-pointer transition-colors ${
          active
            ? "bg-white/[0.14] text-white shadow-sm"
            : "text-white/60 hover:bg-white/[0.07] hover:text-white"
        }`}
      >
        <Icon className={active ? "h-4 w-4 text-brand" : "h-4 w-4 text-white/45 group-hover:text-white/80"} strokeWidth={2} />
        <span>{label}</span>
      </div>
    </Link>
  );
}

function DemoBanner() {
  return (
    <div className="flex items-center justify-center gap-2 border-b border-gold/40 bg-gold/10 px-4 py-1.5 text-center text-xs text-foreground print:hidden">
      <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-gold-foreground" />
      <span>
        <span className="font-semibold">Demo mode</span> — do not upload real tax documents. AI extraction sends file content to a third-party model.
      </span>
    </div>
  );
}

function MobileNavLink({ href, label, matchPrefix }: { href: string; label: string; matchPrefix?: boolean }) {
  const [location] = useLocation();
  const active = matchPrefix ? location.startsWith(href) : location === href;
  return (
    <Link href={href}>
      <span className={`cursor-pointer rounded-md px-2.5 py-1 text-xs font-medium ${active ? "bg-white/15 text-white" : "text-white/60"}`}>{label}</span>
    </Link>
  );
}

function MobileTopBar() {
  return (
    <div className="flex items-center gap-2 border-b border-white/10 bg-[hsl(var(--sidebar))] px-4 py-2.5 text-[hsl(var(--sidebar-foreground))] lg:hidden">
      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-white/10 ring-1 ring-inset ring-white/15">
        <BrandMark className="h-4 w-4 text-brand" />
      </span>
      <span className="mr-auto text-sm font-bold tracking-tight text-white">TaxFlow Assistant</span>
      <MobileNavLink href="/" label="Dashboard" />
      <MobileNavLink href="/clients" label="Clients" matchPrefix />
    </div>
  );
}

function Layout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen flex flex-col bg-background">
      <DemoBanner />
      <div className="flex flex-1 overflow-hidden">
        <aside className="relative hidden w-60 shrink-0 flex-col overflow-hidden bg-[hsl(var(--sidebar))] text-[hsl(var(--sidebar-foreground))] lg:flex">
          <div className="pointer-events-none absolute inset-0 brand-pattern opacity-60" />
          <div className="relative flex items-center gap-3 border-b border-white/10 px-5 py-5">
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-white/10 ring-1 ring-inset ring-white/15">
              <BrandMark className="h-5 w-5 text-brand" />
            </span>
            <div className="leading-tight">
              <div className="text-sm font-bold tracking-tight text-white">TaxFlow Assistant</div>
              <div className="text-[10px] uppercase tracking-[0.16em] text-white/55">CPA Precision Terminal</div>
            </div>
          </div>
          <nav className="relative flex-1 space-y-1 px-3 py-4">
            <NavLink href="/" label="Dashboard" icon={LayoutDashboard} />
            <NavLink href="/clients" label="Clients" icon={Users} matchPrefix />
          </nav>
          <div className="relative border-t border-white/10 px-5 py-3 text-[10px] uppercase tracking-wider text-white/40">
            Tax Year 2024
          </div>
        </aside>
        <div className="flex flex-1 flex-col overflow-hidden">
          <MobileTopBar />
          <main className="flex-1 overflow-auto">
            {children}
          </main>
        </div>
      </div>
    </div>
  );
}

function EditClientRoute(props: { params: { id: string } }) {
  return <ClientForm editId={Number(props.params.id)} />;
}

function Router() {
  return (
    <Layout>
      <Switch>
        <Route path="/" component={Dashboard} />
        <Route path="/clients" component={ClientList} />
        <Route path="/clients/new">{() => <ClientForm />}</Route>
        <Route path="/clients/:id/edit" component={EditClientRoute} />
        <Route path="/clients/:id" component={ClientDetail} />
        <Route component={NotFound} />
      </Switch>
    </Layout>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
          <Router />
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
