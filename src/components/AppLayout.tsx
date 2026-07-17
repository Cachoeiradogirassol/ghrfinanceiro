import { Link, Outlet, useNavigate, useRouter, useRouterState } from "@tanstack/react-router";
import { useAuth } from "@/lib/auth";
import { supabase } from "@/integrations/supabase/client";
import { useEffect, useState } from "react";
import {
  Crown,
  Map,
  Swords,
  Settings,
  LogOut,
  Lock,
  ScrollText,
  ChevronDown,
  Users,
  Landmark,
  FileBarChart,
  BarChart3,
  Sparkle,
  Shield,
  Menu,
  ShoppingBag,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Sheet, SheetContent, SheetTrigger, SheetTitle } from "@/components/ui/sheet";
import { VisuallyHidden } from "@radix-ui/react-visually-hidden";

type NavItem = {
  to: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  children?: Array<{
    to: string;
    label: string;
    icon: React.ComponentType<{ className?: string }>;
  }>;
};

type NavGroup = {
  label: string;
  items: NavItem[];
  masterOnly?: boolean;
};

export function AppLayout({ children }: { children?: React.ReactNode }) {
  const { user, isMaster, loading } = useAuth();
  const navigate = useNavigate();
  const router = useRouter();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    if (!loading && !user) navigate({ to: "/auth" });
  }, [loading, user, navigate]);

  // Close the mobile drawer whenever the route changes.
  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  if (loading || !user) {
    return (
      <div className="flex h-screen items-center justify-center text-muted-foreground">
        Carregando...
      </div>
    );
  }

  const signOut = async () => {
    await supabase.auth.signOut();
    router.invalidate();
    navigate({ to: "/auth", replace: true });
  };

  const groups: NavGroup[] = [
    {
      label: "Operacional",
      items: [
        { to: "/", label: "Painel Executivo", icon: Crown },
        { to: "/lancamentos", label: "Lançamentos", icon: Map },
        { to: "/conciliacao", label: "Conciliação Bancária", icon: Swords },
        { to: "/vendas", label: "Vendas Consolidadas", icon: ShoppingBag },
        { to: "/projecoes", label: "Projeções Financeiras", icon: Sparkle },
        { to: "/contatos", label: "Contatos", icon: Shield },
      ],
    },
    {
      label: "Administração / Controladoria",
      masterOnly: true,
      items: [
        { to: "/contas", label: "Plano de Contas", icon: ScrollText },
        { to: "/relatorios", label: "Relatórios e DRE", icon: BarChart3 },
        {
          to: "/configuracoes",
          label: "Configurações",
          icon: Settings,
          children: [
            { to: "/configuracoes/usuarios", label: "Usuários", icon: Users },
            { to: "/configuracoes/contas-bancarias", label: "Contas Bancárias", icon: Landmark },
            { to: "/configuracoes/plano-de-contas", label: "Plano de Contas", icon: FileBarChart },
          ],
        },
      ],
    },
  ];

  const visibleGroups = groups.filter((g) => !g.masterOnly || isMaster);

  const navBody = (
    <NavContent
      groups={visibleGroups}
      pathname={pathname}
      isMaster={isMaster}
      email={user.email ?? ""}
      onSignOut={signOut}
      onNavigate={() => setMobileOpen(false)}
    />
  );

  return (
    <div className="flex h-screen bg-background text-foreground">
      {/* Desktop sidebar */}
      <aside className="hidden md:flex w-60 border-r border-border bg-sidebar flex-col">
        {navBody}
      </aside>

      {/* Mobile top bar + drawer */}
      <div className="flex flex-1 flex-col min-w-0">
        <header className="md:hidden flex items-center justify-between border-b border-border bg-sidebar px-4 h-14 shrink-0">
          <h1 className="text-base font-bold tracking-tight">CONTROLE.GHR</h1>
          <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
            <SheetTrigger asChild>
              <Button variant="ghost" size="icon" aria-label="Abrir menu">
                <Menu className="h-5 w-5" />
              </Button>
            </SheetTrigger>
            <SheetContent side="right" className="p-0 w-72 bg-sidebar flex flex-col">
              <VisuallyHidden>
                <SheetTitle>Menu de navegação</SheetTitle>
              </VisuallyHidden>
              {navBody}
            </SheetContent>
          </Sheet>
        </header>
        <main className="flex-1 overflow-auto">{children ?? <Outlet />}</main>
      </div>
    </div>
  );
}

function NavContent({
  groups,
  pathname,
  isMaster,
  email,
  onSignOut,
  onNavigate,
}: {
  groups: NavGroup[];
  pathname: string;
  isMaster: boolean;
  email: string;
  onSignOut: () => void;
  onNavigate: () => void;
}) {
  return (
    <>
      <div className="p-5 border-b border-border">
        <h1 className="text-lg font-bold tracking-tight">CONTROLE.GHR</h1>
        <p className="text-xs text-muted-foreground mt-1">
          {isMaster ? (
            <span className="inline-flex items-center gap-1 text-primary">
              <Lock className="h-3 w-3" /> Controladoria
            </span>
          ) : (
            "Usuário"
          )}
        </p>
      </div>
      <nav className="flex-1 p-3 space-y-4 overflow-y-auto">
        {groups.map((g) => (
          <div key={g.label}>
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground px-2 mb-1.5">
              {g.label}
            </p>
            <div className="space-y-0.5">
              {g.items.map((n) =>
                n.children ? (
                  <ExpandableNav
                    key={n.to}
                    item={n}
                    pathname={pathname}
                    onNavigate={onNavigate}
                  />
                ) : (
                  <Link
                    key={n.to}
                    to={n.to}
                    onClick={onNavigate}
                    activeProps={{ className: "bg-primary text-primary-foreground" }}
                    activeOptions={{ exact: n.to === "/" }}
                    className="flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium hover:bg-accent transition-colors"
                  >
                    <n.icon className="h-4 w-4" />
                    {n.label}
                  </Link>
                ),
              )}
            </div>
          </div>
        ))}
      </nav>
      <div className="p-3 border-t border-border space-y-2">
        <p className="text-xs text-muted-foreground px-2 truncate">{email}</p>
        <Button variant="ghost" size="sm" className="w-full justify-start" onClick={onSignOut}>
          <LogOut className="h-4 w-4 mr-2" /> Sair
        </Button>
      </div>
    </>
  );
}

function ExpandableNav({
  item,
  pathname,
  onNavigate,
}: {
  item: NavItem;
  pathname: string;
  onNavigate: () => void;
}) {
  const isActiveBranch = pathname.startsWith(item.to);
  const [open, setOpen] = useState(isActiveBranch);
  useEffect(() => {
    if (isActiveBranch) setOpen(true);
  }, [isActiveBranch]);

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger
        className={`flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm font-medium hover:bg-accent transition-colors ${
          isActiveBranch ? "bg-accent text-accent-foreground" : ""
        }`}
      >
        <item.icon className="h-4 w-4" />
        <span className="flex-1 text-left">{item.label}</span>
        <ChevronDown className={`h-4 w-4 transition-transform ${open ? "rotate-180" : ""}`} />
      </CollapsibleTrigger>
      <CollapsibleContent className="overflow-hidden data-[state=closed]:animate-accordion-up data-[state=open]:animate-accordion-down">
        <div className="mt-0.5 ml-3 pl-3 border-l border-border space-y-0.5">
          {item.children!.map((c) => (
            <Link
              key={c.to}
              to={c.to}
              onClick={onNavigate}
              activeProps={{ className: "bg-primary text-primary-foreground" }}
              className="flex items-center gap-2 rounded-md px-3 py-1.5 text-xs font-medium hover:bg-accent transition-colors"
            >
              <c.icon className="h-3.5 w-3.5" />
              {c.label}
            </Link>
          ))}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}
