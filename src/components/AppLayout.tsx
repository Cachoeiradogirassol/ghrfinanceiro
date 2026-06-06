import { Link, Outlet, useNavigate, useRouter } from "@tanstack/react-router";
import { useAuth } from "@/lib/auth";
import { supabase } from "@/integrations/supabase/client";
import { useEffect } from "react";
import {
  LayoutDashboard,
  ListChecks,
  GitMerge,
  TrendingUp,
  Settings,
  LogOut,
  Lock,
} from "lucide-react";
import { Button } from "@/components/ui/button";

export function AppLayout() {
  const { user, isMaster, loading } = useAuth();
  const navigate = useNavigate();
  const router = useRouter();

  useEffect(() => {
    if (!loading && !user) navigate({ to: "/auth" });
  }, [loading, user, navigate]);

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

  const nav = [
    { to: "/", label: "Dashboard", icon: LayoutDashboard },
    { to: "/lancamentos", label: "Lançamentos", icon: ListChecks },
    { to: "/conciliacao", label: "Conciliação", icon: GitMerge },
    { to: "/projecao", label: "Projeção + IA", icon: TrendingUp },
  ];

  return (
    <div className="flex h-screen bg-background text-foreground">
      <aside className="w-64 border-r border-border bg-sidebar flex flex-col">
        <div className="p-6 border-b border-border">
          <h1 className="text-lg font-bold tracking-tight">CONTROLE.GHR</h1>
          <p className="text-xs text-muted-foreground mt-1">
            {isMaster ? (
              <span className="inline-flex items-center gap-1 text-primary">
                <Lock className="h-3 w-3" /> Master
              </span>
            ) : (
              "Usuário"
            )}
          </p>
        </div>
        <nav className="flex-1 p-3 space-y-1">
          {nav.map((n) => (
            <Link
              key={n.to}
              to={n.to}
              activeProps={{ className: "bg-primary text-primary-foreground" }}
              activeOptions={{ exact: n.to === "/" }}
              className="flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium hover:bg-accent transition-colors"
            >
              <n.icon className="h-4 w-4" />
              {n.label}
            </Link>
          ))}
          {isMaster && (
            <Link
              to="/contas"
              activeProps={{ className: "bg-primary text-primary-foreground" }}
              className="flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium hover:bg-accent transition-colors"
            >
              <Settings className="h-4 w-4" />
              Plano de Contas
            </Link>
          )}
        </nav>
        <div className="p-3 border-t border-border space-y-2">
          <p className="text-xs text-muted-foreground px-2 truncate">
            {user.email}
          </p>
          <Button
            variant="ghost"
            size="sm"
            className="w-full justify-start"
            onClick={signOut}
          >
            <LogOut className="h-4 w-4 mr-2" /> Sair
          </Button>
        </div>
      </aside>
      <main className="flex-1 overflow-auto">
        <Outlet />
      </main>
    </div>
  );
}
