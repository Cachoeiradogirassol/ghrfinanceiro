import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { toast } from "sonner";
import { Lock } from "lucide-react";

export const Route = createFileRoute("/auth")({
  head: () => ({
    meta: [
      { title: "Login — CONTROLE.GHR" },
      {
        name: "description",
        content:
          "Acesse o CONTROLE.GHR para gerenciar lançamentos, conciliação bancária e relatórios financeiros do Grupo GHR.",
      },
      { property: "og:title", content: "Login — CONTROLE.GHR" },
      {
        property: "og:description",
        content:
          "Acesse o CONTROLE.GHR para gerenciar lançamentos, conciliação bancária e relatórios financeiros do Grupo GHR.",
      },
    ],
    links: [{ rel: "canonical", href: "https://ghrfinanceiro.lovable.app/auth" }],
  }),
  component: AuthPage,
});

function AuthPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) navigate({ to: "/" });
    });
  }, [navigate]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const { error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });
      if (error) throw error;
      navigate({ to: "/" });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao entrar");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md p-8">
        <div className="flex items-center gap-2 mb-1">
          <Lock className="h-5 w-5 text-primary" />
          <h1 className="text-2xl font-bold">CONTROLE.GHR</h1>
        </div>
        <p className="text-sm text-muted-foreground mb-6">
          Sistema financeiro restrito — acesso apenas para usuários cadastrados.
        </p>
        <form onSubmit={submit} className="space-y-4">
          <div>
            <Label htmlFor="email">E-mail</Label>
            <Input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoComplete="email"
            />
          </div>
          <div>
            <Label htmlFor="password">Senha</Label>
            <Input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              autoComplete="current-password"
            />
          </div>
          <Button type="submit" className="w-full" disabled={busy}>
            {busy ? "..." : "Entrar"}
          </Button>
        </form>
        <p className="mt-6 text-xs text-muted-foreground text-center">
          Novos operadores são cadastrados pelo Usuário Master em Configurações.
        </p>
      </Card>
    </div>
  );
}
