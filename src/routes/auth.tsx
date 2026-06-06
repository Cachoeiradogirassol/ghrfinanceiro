import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { PasswordInput } from "@/components/ui/password-input";
import { toast } from "sonner";
import { Lock, ArrowLeft } from "lucide-react";

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
      { property: "og:url", content: "https://ghrfinanceiro.lovable.app/auth" },
    ],
    links: [{ rel: "canonical", href: "https://ghrfinanceiro.lovable.app/auth" }],
  }),
  component: AuthPage,
});

function AuthPage() {
  const [mode, setMode] = useState<"login" | "forgot">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) navigate({ to: "/" });
    });
  }, [navigate]);

  const submitLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) throw error;
      navigate({ to: "/" });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao entrar");
    } finally {
      setBusy(false);
    }
  };

  const submitForgot = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}/auth/redefinir-senha`,
      });
      if (error) throw error;
      toast.success("Enviamos um link de redefinição para o seu e-mail.");
      setMode("login");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao enviar e-mail");
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
          {mode === "login"
            ? "Sistema financeiro restrito — acesso apenas para usuários cadastrados."
            : "Informe seu e-mail para receber o link de redefinição de senha."}
        </p>

        {mode === "login" ? (
          <form onSubmit={submitLogin} className="space-y-4">
            <div>
              <Label htmlFor="email">E-mail</Label>
              <Input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email" />
            </div>
            <div>
              <div className="flex items-center justify-between">
                <Label htmlFor="password">Senha</Label>
                <button
                  type="button"
                  onClick={() => setMode("forgot")}
                  className="text-xs text-primary hover:underline"
                >
                  Esqueceu sua senha?
                </button>
              </div>
              <PasswordInput
                id="password"
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
        ) : (
          <form onSubmit={submitForgot} className="space-y-4">
            <div>
              <Label htmlFor="recovery-email">E-mail cadastrado</Label>
              <Input
                id="recovery-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoComplete="email"
              />
            </div>
            <Button type="submit" className="w-full" disabled={busy}>
              {busy ? "..." : "Enviar link de redefinição"}
            </Button>
            <button
              type="button"
              onClick={() => setMode("login")}
              className="w-full text-xs text-muted-foreground hover:text-foreground flex items-center justify-center gap-1"
            >
              <ArrowLeft className="h-3 w-3" /> Voltar ao login
            </button>
          </form>
        )}

        <p className="mt-6 text-xs text-muted-foreground text-center">
          Novos operadores são cadastrados pelo Usuário Master em Configurações.
        </p>
      </Card>
    </div>
  );
}
