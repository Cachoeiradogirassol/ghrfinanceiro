import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { AppLayout } from "@/components/AppLayout";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { useAuth } from "@/lib/auth";
import {
  listUsers,
  createUser,
  setUserActive,
  resetUserPassword,
  upsertCostCenter,
  upsertAccount,
  deleteAccount,
  upsertBankAccount,
} from "@/lib/admin.functions";
import { listCostCenters, listAccounts, listBankAccounts } from "@/lib/finance.functions";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import { Settings, Lock, Trash2, Plus } from "lucide-react";

export const Route = createFileRoute("/configuracoes")({
  head: () => ({ meta: [{ title: "Configurações — CONTROLE.GHR" }] }),
  component: () => (
    <AppLayout>
      <ConfigPage />
    </AppLayout>
  ),
});

function ConfigPage() {
  const { isMaster, loading } = useAuth();
  const nav = useNavigate();
  useEffect(() => {
    if (!loading && !isMaster) nav({ to: "/" });
  }, [loading, isMaster, nav]);

  if (!isMaster) return null;

  return (
    <div className="p-8 space-y-6">
      <div>
        <h1 className="text-3xl font-bold flex items-center gap-2">
          <Settings className="h-6 w-6 text-primary" /> Configurações
        </h1>
        <p className="text-muted-foreground">
          Gestão interna — acesso restrito ao Usuário Master.
        </p>
      </div>
      <Tabs defaultValue="users">
        <TabsList>
          <TabsTrigger value="users">Usuários</TabsTrigger>
          <TabsTrigger value="banks">Contas Bancárias</TabsTrigger>
          <TabsTrigger value="plan">Plano de Contas</TabsTrigger>
        </TabsList>
        <TabsContent value="users"><UsersTab /></TabsContent>
        <TabsContent value="banks"><BanksTab /></TabsContent>
        <TabsContent value="plan"><PlanTab /></TabsContent>
      </Tabs>
    </div>
  );
}

// ---------------- USERS ----------------
function UsersTab() {
  const qc = useQueryClient();
  const listFn = useServerFn(listUsers);
  const createFn = useServerFn(createUser);
  const activeFn = useServerFn(setUserActive);
  const resetFn = useServerFn(resetUserPassword);
  const q = useQuery({ queryKey: ["admin-users"], queryFn: () => listFn() });
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [role, setRole] = useState<"user" | "master">("user");

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await createFn({ data: { email, password, display_name: displayName, role } });
      toast.success("Usuário criado");
      setEmail(""); setPassword(""); setDisplayName(""); setRole("user");
      qc.invalidateQueries({ queryKey: ["admin-users"] });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro");
    }
  };

  return (
    <div className="grid gap-4 md:grid-cols-2">
      <Card className="p-5">
        <h3 className="font-semibold mb-3 flex items-center gap-2"><Plus className="h-4 w-4" /> Novo operador</h3>
        <form onSubmit={submit} className="space-y-3">
          <div><Label>Nome</Label><Input value={displayName} onChange={(e) => setDisplayName(e.target.value)} /></div>
          <div><Label>E-mail</Label><Input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} /></div>
          <div><Label>Senha inicial</Label><Input type="password" required minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} /></div>
          <div>
            <Label>Nível de acesso</Label>
            <Select value={role} onValueChange={(v) => setRole(v as "user" | "master")}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="user">Operador</SelectItem>
                <SelectItem value="master">Master</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <Button type="submit">Criar usuário</Button>
        </form>
      </Card>
      <Card className="p-5">
        <h3 className="font-semibold mb-3">Usuários cadastrados</h3>
        <div className="space-y-2">
          {(q.data ?? []).map((u) => (
            <div key={u.id} className="flex items-center justify-between border-b border-border pb-2 gap-2">
              <div className="min-w-0">
                <p className="text-sm font-medium truncate">{u.email}</p>
                <p className="text-xs text-muted-foreground">
                  {u.role === "master" ? <Badge variant="destructive"><Lock className="h-3 w-3 mr-1" />Master</Badge> : <Badge variant="secondary">Operador</Badge>}
                  {u.banned_until && <span className="ml-2 text-destructive">desativado</span>}
                </p>
              </div>
              <div className="flex gap-1">
                <Button size="sm" variant="outline" onClick={async () => {
                  const pw = prompt("Nova senha (mín 8 caracteres):");
                  if (!pw || pw.length < 8) return;
                  try { await resetFn({ data: { user_id: u.id, password: pw } }); toast.success("Senha atualizada"); }
                  catch (e) { toast.error(e instanceof Error ? e.message : "Erro"); }
                }}>Senha</Button>
                <Button size="sm" variant={u.banned_until ? "default" : "outline"} onClick={async () => {
                  try {
                    await activeFn({ data: { user_id: u.id, active: !!u.banned_until } });
                    toast.success(u.banned_until ? "Reativado" : "Desativado");
                    qc.invalidateQueries({ queryKey: ["admin-users"] });
                  } catch (e) { toast.error(e instanceof Error ? e.message : "Erro"); }
                }}>{u.banned_until ? "Reativar" : "Desativar"}</Button>
              </div>
            </div>
          ))}
          {!q.data?.length && <p className="text-sm text-muted-foreground">Nenhum usuário.</p>}
        </div>
      </Card>
    </div>
  );
}

// ---------------- BANKS ----------------
function BanksTab() {
  const qc = useQueryClient();
  const listFn = useServerFn(listBankAccounts);
  const upsertFn = useServerFn(upsertBankAccount);
  const q = useQuery({ queryKey: ["admin-banks"], queryFn: () => listFn() });
  const [form, setForm] = useState({ name: "", bank: "", initial_balance: 0, master_only: false });

  return (
    <div className="grid gap-4 md:grid-cols-2">
      <Card className="p-5">
        <h3 className="font-semibold mb-3 flex items-center gap-2"><Plus className="h-4 w-4" /> Nova conta bancária</h3>
        <form onSubmit={async (e) => {
          e.preventDefault();
          try {
            await upsertFn({ data: { ...form, initial_balance: Number(form.initial_balance) } });
            toast.success("Conta criada");
            setForm({ name: "", bank: "", initial_balance: 0, master_only: false });
            qc.invalidateQueries({ queryKey: ["admin-banks"] });
          } catch (err) { toast.error(err instanceof Error ? err.message : "Erro"); }
        }} className="space-y-3">
          <div><Label>Nome</Label><Input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
          <div><Label>Banco</Label><Input value={form.bank} onChange={(e) => setForm({ ...form, bank: e.target.value })} /></div>
          <div><Label>Saldo inicial</Label><Input type="number" step="0.01" value={form.initial_balance} onChange={(e) => setForm({ ...form, initial_balance: Number(e.target.value) })} /></div>
          <div className="flex items-center gap-2"><Switch checked={form.master_only} onCheckedChange={(v) => setForm({ ...form, master_only: v })} /><Label>Apenas Master (GHR)</Label></div>
          <Button type="submit">Salvar</Button>
        </form>
      </Card>
      <Card className="p-5">
        <h3 className="font-semibold mb-3">Contas existentes</h3>
        <div className="space-y-3">
          {(q.data ?? []).map((b) => (
            <BankRow key={b.id} bank={b} onSaved={() => qc.invalidateQueries({ queryKey: ["admin-banks"] })} />
          ))}
        </div>
      </Card>
    </div>
  );
}

function BankRow({ bank, onSaved }: { bank: { id: string; name: string; bank: string | null; initial_balance: number; master_only: boolean }; onSaved: () => void }) {
  const upsertFn = useServerFn(upsertBankAccount);
  const [name, setName] = useState(bank.name);
  const [balance, setBalance] = useState(Number(bank.initial_balance));
  return (
    <div className="border-b border-border pb-3 grid grid-cols-1 sm:grid-cols-[1fr_140px_auto] gap-2 items-end">
      <div><Label className="text-xs">Nome</Label><Input value={name} onChange={(e) => setName(e.target.value)} /></div>
      <div><Label className="text-xs">Saldo inicial</Label><Input type="number" step="0.01" value={balance} onChange={(e) => setBalance(Number(e.target.value))} /></div>
      <Button size="sm" onClick={async () => {
        try {
          await upsertFn({ data: { id: bank.id, name, bank: bank.bank, initial_balance: balance, master_only: bank.master_only } });
          toast.success("Atualizado"); onSaved();
        } catch (e) { toast.error(e instanceof Error ? e.message : "Erro"); }
      }}>Salvar</Button>
      {bank.master_only && <Badge variant="destructive" className="col-span-full w-fit"><Lock className="h-3 w-3 mr-1" />GHR</Badge>}
    </div>
  );
}

// ---------------- PLAN ----------------
function PlanTab() {
  const qc = useQueryClient();
  const ccFn = useServerFn(listCostCenters);
  const accFn = useServerFn(listAccounts);
  const upsertCC = useServerFn(upsertCostCenter);
  const upsertAcc = useServerFn(upsertAccount);
  const delAcc = useServerFn(deleteAccount);
  const ccs = useQuery({ queryKey: ["admin-cc"], queryFn: () => ccFn() });
  const accs = useQuery({ queryKey: ["admin-acc"], queryFn: () => accFn() });
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["admin-cc"] });
    qc.invalidateQueries({ queryKey: ["admin-acc"] });
  };

  return (
    <div className="space-y-4">
      <NewCostCenter onSaved={refresh} upsertCC={upsertCC} />
      {(ccs.data ?? []).map((cc) => (
        <Card key={cc.id} className="p-5">
          <CostCenterHeader cc={cc} upsertCC={upsertCC} onSaved={refresh} />
          <div className="mt-4 space-y-2">
            {(accs.data ?? []).filter((a) => a.cost_center_id === cc.id).map((a) => (
              <div key={a.id} className="flex items-center gap-2">
                <Input defaultValue={a.name} onBlur={async (e) => {
                  if (e.target.value === a.name) return;
                  try { await upsertAcc({ data: { id: a.id, cost_center_id: cc.id, name: e.target.value, kind: a.kind } }); toast.success("Salvo"); refresh(); }
                  catch (err) { toast.error(err instanceof Error ? err.message : "Erro"); }
                }} />
                <Badge variant={a.kind === "revenue" ? "default" : "secondary"}>{a.kind === "revenue" ? "Receita" : "Despesa"}</Badge>
                <Button size="icon" variant="ghost" onClick={async () => {
                  if (!confirm("Remover subcategoria?")) return;
                  try { await delAcc({ data: { id: a.id } }); toast.success("Removida"); refresh(); }
                  catch (err) { toast.error(err instanceof Error ? err.message : "Erro"); }
                }}><Trash2 className="h-4 w-4" /></Button>
              </div>
            ))}
            <NewAccountRow ccId={cc.id} upsertAcc={upsertAcc} onSaved={refresh} />
          </div>
        </Card>
      ))}
    </div>
  );
}

function NewCostCenter({ upsertCC, onSaved }: { upsertCC: ReturnType<typeof useServerFn<typeof upsertCostCenter>>; onSaved: () => void }) {
  const [code, setCode] = useState(10);
  const [name, setName] = useState("");
  const [masterOnly, setMasterOnly] = useState(false);
  return (
    <Card className="p-4 flex flex-wrap items-end gap-2">
      <div className="w-24"><Label className="text-xs">Código</Label><Input type="number" value={code} onChange={(e) => setCode(Number(e.target.value))} /></div>
      <div className="flex-1 min-w-[200px]"><Label className="text-xs">Novo Centro de Custo</Label><Input value={name} onChange={(e) => setName(e.target.value)} /></div>
      <div className="flex items-center gap-2"><Switch checked={masterOnly} onCheckedChange={setMasterOnly} /><Label>GHR (Master)</Label></div>
      <Button size="sm" onClick={async () => {
        if (!name) return;
        try { await upsertCC({ data: { code, name, master_only: masterOnly } }); toast.success("Criado"); setName(""); onSaved(); }
        catch (e) { toast.error(e instanceof Error ? e.message : "Erro"); }
      }}><Plus className="h-4 w-4 mr-1" />Adicionar</Button>
    </Card>
  );
}

function CostCenterHeader({ cc, upsertCC, onSaved }: { cc: { id: string; code: number; name: string; master_only: boolean }; upsertCC: ReturnType<typeof useServerFn<typeof upsertCostCenter>>; onSaved: () => void }) {
  const [name, setName] = useState(cc.name);
  return (
    <div className="flex items-center gap-2">
      <span className="text-sm font-mono text-muted-foreground w-10">{cc.code}</span>
      <Input value={name} onChange={(e) => setName(e.target.value)} onBlur={async () => {
        if (name === cc.name) return;
        try { await upsertCC({ data: { id: cc.id, code: cc.code, name, master_only: cc.master_only } }); toast.success("Salvo"); onSaved(); }
        catch (e) { toast.error(e instanceof Error ? e.message : "Erro"); }
      }} />
      {cc.master_only && <Badge variant="destructive"><Lock className="h-3 w-3 mr-1" />Master</Badge>}
    </div>
  );
}

function NewAccountRow({ ccId, upsertAcc, onSaved }: { ccId: string; upsertAcc: ReturnType<typeof useServerFn<typeof upsertAccount>>; onSaved: () => void }) {
  const [name, setName] = useState("");
  const [kind, setKind] = useState<"expense" | "revenue">("expense");
  return (
    <div className="flex items-center gap-2 pt-2">
      <Input placeholder="Nova subcategoria..." value={name} onChange={(e) => setName(e.target.value)} />
      <Select value={kind} onValueChange={(v) => setKind(v as "expense" | "revenue")}>
        <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem value="expense">Despesa</SelectItem>
          <SelectItem value="revenue">Receita</SelectItem>
        </SelectContent>
      </Select>
      <Button size="sm" variant="outline" onClick={async () => {
        if (!name) return;
        try { await upsertAcc({ data: { cost_center_id: ccId, name, kind } }); toast.success("Adicionada"); setName(""); onSaved(); }
        catch (e) { toast.error(e instanceof Error ? e.message : "Erro"); }
      }}><Plus className="h-4 w-4" /></Button>
    </div>
  );
}
