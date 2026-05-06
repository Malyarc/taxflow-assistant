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

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      staleTime: 30_000,
    },
  },
});

function NavLink({ href, label, matchPrefix }: { href: string; label: string; matchPrefix?: boolean }) {
  const [location] = useLocation();
  const active = matchPrefix ? location.startsWith(href) : location === href;
  return (
    <Link href={href}>
      <div className={`px-4 py-2.5 rounded-md text-sm font-medium cursor-pointer transition-colors ${active ? "bg-primary text-primary-foreground" : "hover:bg-muted text-muted-foreground hover:text-foreground"}`}>
        {label}
      </div>
    </Link>
  );
}

function Layout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen flex bg-background">
      <aside className="w-56 border-r bg-card flex flex-col shrink-0">
        <div className="px-6 py-5 border-b">
          <h1 className="text-lg font-bold tracking-tight text-primary">TaxFlow Pro</h1>
          <p className="text-[11px] text-muted-foreground mt-0.5 uppercase tracking-widest">CPA Precision Terminal</p>
        </div>
        <nav className="flex-1 px-3 py-4 space-y-1">
          <NavLink href="/" label="Dashboard" />
          <NavLink href="/clients" label="Clients" matchPrefix />
        </nav>
      </aside>
      <main className="flex-1 overflow-auto">
        {children}
      </main>
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
