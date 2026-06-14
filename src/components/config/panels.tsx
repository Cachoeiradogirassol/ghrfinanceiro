import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import {
  listUsers,
  createUser,
  setUserActive,
  updateUser,
  upsertCostCenter,
  upsertAccount,
  deleteAccount,
  upsertBankAccount,
  archiveOrDeleteBankAccount,
  archiveOrDeleteCostCenter,
} from "@/lib/admin.functions";
import {
  listCostCenters,
  listAccounts,
  listBankAccounts,
} from "@/lib/finance.functions";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PasswordInput } from "@/components/ui/password-input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import { Lock, Archive, Trash2, Plus, Pencil } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ENTERPRISES, type Enterprise } from "@/lib/enterprises";
import { PluggyConnection } from "@/components/PluggyConnection";

// ---------------- USERS ----------------
type AdminUser = {
  id: string;
  email: string | undefined;
  display_name?: string;
  banned_until: string | null;
  role: string;
  enterprise_restriction?: string | null;
};

export function UsersTab() {
  const qc = useQueryClient();
  const listFn = useServerFn(listUsers);
  const createFn = useServerFn(createUser);
  const activeFn = useServerFn(setUserActive);
  const updateFn = useServerFn(updateUser);
  const q = useQuery({ queryKey: ["admin-users"], queryFn: () => listFn() });
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [role, setRole] = useState<"user" | "master">("user");
  const [restriction, setRestriction] = useState<string>("none");
  const [editing, setEditing] = useState<AdminUser | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await createFn({ data: {
        email, password, display_name: displayName, role,
        enterprise_restriction: role === "master" || restriction === "none" ? null : (restriction as Enterprise["value"]),
      } });
      toast.success("Usuário criado com sucesso!");
      setEmail(""); setPassword(""); setDisplayName(""); setRole("user"); setRestriction("none");
      qc.invalidateQueries({ queryKey: ["admin-users"] });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro");
    }
  };

  return (
    <div className="space-y-4" translate="no">
      <Card className="p-5">
        <h3 className="font-semibold mb-3 flex items-center gap-2"><Plus className="h-4 w-4" /> Novo operador</h3>
        <form onSubmit={submit} className="grid gap-3 md:grid-cols-2">
          <div><Label>Nome</Label><Input value={displayName} onChange={(e) => setDisplayName(e.target.value)} /></div>
          <div><Label>E-mail</Label><Input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} /></div>
          <div><Label>Senha inicial</Label><PasswordInput required minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} /></div>
          <div>
            <Label>Nível de acesso</Label>
            <Select value={role} onValueChange={(v) => setRole(v as "user" | "master")}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="user"><span translate="no">Operador</span></SelectItem>
                <SelectItem value="master"><span translate="no">Master</span></SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Restrição a empreendimento (operador)</Label>
            <Select value={restriction} onValueChange={setRestriction} disabled={role === "master"}>
              <SelectTrigger><SelectValue placeholder="Sem restrição" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Sem restrição (todos)</SelectItem>
                {ENTERPRISES.filter((e) => !e.masterOnly).map((e) => (
                  <SelectItem key={e.value} value={e.value}>{e.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground mt-1">Master sempre tem acesso total.</p>
          </div>
          <div className="md:col-span-2"><Button type="submit">Criar usuário</Button></div>
        </form>
      </Card>

      <Card className="p-5">
        <h3 className="font-semibold mb-3">Usuários cadastrados</h3>
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nome</TableHead>
                <TableHead>E-mail</TableHead>
                <TableHead>Nível</TableHead>
                <TableHead>Restrição</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Ações</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(q.data ?? []).map((u) => (
                <TableRow key={u.id}>
                  <TableCell className="font-medium">{u.display_name || "—"}</TableCell>
                  <TableCell className="text-sm">{u.email}</TableCell>
                  <TableCell>
                    {u.role === "master"
                      ? <Badge variant="destructive" translate="no"><Lock className="h-3 w-3 mr-1" />Master</Badge>
                      : <Badge variant="secondary" translate="no">Operador</Badge>}
                  </TableCell>
                  <TableCell className="text-xs">
                    {u.role === "master"
                      ? <span className="text-muted-foreground">—</span>
                      : (u.enterprise_restriction
                          ? <Badge variant="outline">{ENTERPRISES.find((e) => e.value === u.enterprise_restriction)?.label ?? u.enterprise_restriction}</Badge>
                          : <span className="text-muted-foreground">Todos</span>)}
                  </TableCell>
                  <TableCell>
                    {u.banned_until ? <Badge variant="outline">Desativado</Badge> : <Badge>Ativo</Badge>}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-1">
                      <Button size="sm" variant="outline" onClick={() => setEditing(u as AdminUser)}>
                        <Pencil className="h-3 w-3 mr-1" />Editar
                      </Button>
                      <Button size="sm" variant={u.banned_until ? "default" : "outline"} onClick={async () => {
                        try {
                          await activeFn({ data: { user_id: u.id, active: !!u.banned_until } });
                          toast.success(u.banned_until ? "Usuário reativado" : "Usuário desativado");
                          qc.invalidateQueries({ queryKey: ["admin-users"] });
                        } catch (e) { toast.error(e instanceof Error ? e.message : "Erro"); }
                      }}>{u.banned_until ? "Reativar" : "Desativar"}</Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
              {!q.data?.length && (
                <TableRow><TableCell colSpan={6} className="text-center text-sm text-muted-foreground">Nenhum usuário cadastrado.</TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      </Card>

      <EditUserDialog
        user={editing}
        onClose={() => setEditing(null)}
        onSave={async (payload) => {
          try {
            await updateFn({ data: payload });
            toast.success("Usuário atualizado com sucesso!");
            setEditing(null);
            qc.invalidateQueries({ queryKey: ["admin-users"] });
          } catch (e) { toast.error(e instanceof Error ? e.message : "Erro"); }
        }}
      />
    </div>
  );
}

function EditUserDialog({
  user,
  onClose,
  onSave,
}: {
  user: AdminUser | null;
  onClose: () => void;
  onSave: (data: { user_id: string; email: string; display_name: string; role: "user" | "master"; password?: string; enterprise_restriction: Enterprise["value"] | null }) => Promise<void>;
}) {
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"user" | "master">("user");
  const [password, setPassword] = useState("");
  const [restriction, setRestriction] = useState<string>("none");

  useEffect(() => {
    if (!user) return;
    setDisplayName(user.display_name ?? "");
    setEmail(user.email ?? "");
    setRole((user.role as "user" | "master") ?? "user");
    setPassword("");
    setRestriction(user.enterprise_restriction ?? "none");
  }, [user]);

  return (
    <Dialog open={!!user} onOpenChange={(o) => !o && onClose()}>
      <DialogContent translate="no">
        <DialogHeader><DialogTitle>Editar usuário</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div><Label>Nome completo</Label><Input value={displayName} onChange={(e) => setDisplayName(e.target.value)} /></div>
          <div><Label>E-mail</Label><Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} /></div>
          <div>
            <Label>Nível de acesso</Label>
            <Select value={role} onValueChange={(v) => setRole(v as "user" | "master")}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="user"><span translate="no">Operador</span></SelectItem>
                <SelectItem value="master"><span translate="no">Master</span></SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Restrição a empreendimento</Label>
            <Select value={restriction} onValueChange={setRestriction} disabled={role === "master"}>
              <SelectTrigger><SelectValue placeholder="Sem restrição" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Sem restrição (todos)</SelectItem>
                {ENTERPRISES.filter((e) => !e.masterOnly).map((e) => (
                  <SelectItem key={e.value} value={e.value}>{e.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground mt-1">Master sempre tem acesso total — restrição é ignorada.</p>
          </div>
          <div>
            <Label>Redefinir senha (opcional)</Label>
            <PasswordInput placeholder="Deixe em branco para manter" value={password} onChange={(e) => setPassword(e.target.value)} />
            <p className="text-xs text-muted-foreground mt-1">Mínimo 8 caracteres se for alterar.</p>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancelar</Button>
          <Button onClick={() => {
            if (!user) return;
            if (password && password.length < 8) { toast.error("A senha deve ter pelo menos 8 caracteres."); return; }
            onSave({
              user_id: user.id,
              email,
              display_name: displayName,
              role,
              password: password || undefined,
              enterprise_restriction: role === "master" || restriction === "none" ? null : (restriction as Enterprise["value"]),
            });
          }}>Salvar alterações</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}


// ---------------- BANKS ----------------
export function BanksTab() {
  const qc = useQueryClient();
  const listFn = useServerFn(listBankAccounts);
  const upsertFn = useServerFn(upsertBankAccount);
  const archiveFn = useServerFn(archiveOrDeleteBankAccount);
  const q = useQuery({ queryKey: ["admin-banks"], queryFn: () => listFn() });
  const [form, setForm] = useState<{
    name: string;
    bank: string;
    initial_balance: number;
    enterprise: Enterprise["value"];
    master_only: boolean;
  }>({ name: "", bank: "", initial_balance: 0, enterprise: "ghr", master_only: false });

  return (
    <div className="grid gap-4 md:grid-cols-2">
      <PluggyConnection
        banks={q.data ?? []}
        onConnected={() => {
          qc.invalidateQueries({ queryKey: ["admin-banks"] });
          qc.invalidateQueries({ queryKey: ["banks"] });
        }}
      />
      <Card className="p-5">
        <h3 className="font-semibold mb-3 flex items-center gap-2"><Plus className="h-4 w-4" /> Nova conta bancária</h3>
        <form onSubmit={async (e) => {
          e.preventDefault();
          try {
            await upsertFn({ data: { ...form, initial_balance: Number(form.initial_balance), is_active: true } });
            toast.success("Conta criada");
            setForm({ name: "", bank: "", initial_balance: 0, enterprise: "ghr", master_only: false });
            qc.invalidateQueries({ queryKey: ["admin-banks"] });
            qc.invalidateQueries({ queryKey: ["banks"] });
          } catch (err) { toast.error(err instanceof Error ? err.message : "Erro"); }
        }} className="space-y-3">
          <div><Label>Nome</Label><Input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
          <div><Label>Banco</Label><Input value={form.bank} onChange={(e) => setForm({ ...form, bank: e.target.value })} /></div>
          <div>
            <Label>Empreendimento</Label>
            <Select value={form.enterprise} onValueChange={(v) => setForm({ ...form, enterprise: v as Enterprise["value"] })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {ENTERPRISES.map((e) => (
                  <SelectItem key={e.value} value={e.value}>{e.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div><Label>Saldo inicial</Label><Input type="number" step="0.01" value={form.initial_balance} onChange={(e) => setForm({ ...form, initial_balance: Number(e.target.value) })} /></div>
          <div className="flex items-center gap-2"><Switch checked={form.master_only} onCheckedChange={(v) => setForm({ ...form, master_only: v })} /><Label>Restrita ao Master</Label></div>
          <Button type="submit">Salvar</Button>
        </form>
      </Card>
      <Card className="p-5">
        <h3 className="font-semibold mb-3">Contas existentes</h3>
        <div className="space-y-3">
          {(q.data ?? []).map((b) => (
            <BankRow
              key={b.id}
              bank={b}
              onChanged={() => { qc.invalidateQueries({ queryKey: ["admin-banks"] }); qc.invalidateQueries({ queryKey: ["banks"] }); }}
              archive={archiveFn}
            />
          ))}
        </div>
      </Card>
    </div>
  );
}

function BankRow({
  bank,
  onChanged,
  archive,
}: {
  bank: {
    id: string;
    name: string;
    bank: string | null;
    initial_balance: number;
    master_only: boolean;
    enterprise: Enterprise["value"];
    is_active?: boolean;
  };
  onChanged: () => void;
  archive: (args: { data: { id: string } }) => Promise<{ archived?: boolean; deleted?: boolean }>;
}) {
  const upsertFn = useServerFn(upsertBankAccount);
  const [name, setName] = useState(bank.name);
  const [balance, setBalance] = useState(Number(bank.initial_balance));
  const [enterprise, setEnterprise] = useState<Enterprise["value"]>(bank.enterprise);
  const inactive = bank.is_active === false;

  return (
    <div className={`border-b border-border pb-3 space-y-2 ${inactive ? "opacity-60" : ""}`}>
      <div className="grid grid-cols-1 sm:grid-cols-[1fr_140px_140px] gap-2 items-end">
        <div><Label className="text-xs">Nome</Label><Input value={name} onChange={(e) => setName(e.target.value)} /></div>
        <div>
          <Label className="text-xs">Empreendimento</Label>
          <Select value={enterprise} onValueChange={(v) => setEnterprise(v as Enterprise["value"])}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {ENTERPRISES.map((e) => <SelectItem key={e.value} value={e.value}>{e.label}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div><Label className="text-xs">Saldo inicial</Label><Input type="number" step="0.01" value={balance} onChange={(e) => setBalance(Number(e.target.value))} /></div>
      </div>
      <div className="flex items-center gap-2">
        <Button size="sm" onClick={async () => {
          try {
            await upsertFn({ data: { id: bank.id, name, bank: bank.bank, initial_balance: balance, enterprise, master_only: bank.master_only, is_active: !inactive } });
            toast.success("Atualizado"); onChanged();
          } catch (e) { toast.error(e instanceof Error ? e.message : "Erro"); }
        }}>Salvar</Button>
        <Button size="sm" variant="outline" onClick={async () => {
          if (!confirm("Arquivar ou excluir esta conta?")) return;
          try {
            const r = await archive({ data: { id: bank.id } });
            toast.success(r.deleted ? "Excluída" : "Arquivada (possui histórico)");
            onChanged();
          } catch (e) { toast.error(e instanceof Error ? e.message : "Erro"); }
        }}>
          {inactive ? <Trash2 className="h-3 w-3 mr-1" /> : <Archive className="h-3 w-3 mr-1" />}
          {inactive ? "Excluir" : "Arquivar"}
        </Button>
        {bank.master_only && <Badge variant="destructive"><Lock className="h-3 w-3 mr-1" />Master</Badge>}
        {inactive && <Badge variant="secondary">Inativa</Badge>}
      </div>
    </div>
  );
}

// ---------------- PLAN ----------------
export function PlanTab() {
  const qc = useQueryClient();
  const ccFn = useServerFn(listCostCenters);
  const accFn = useServerFn(listAccounts);
  const upsertCC = useServerFn(upsertCostCenter);
  const upsertAcc = useServerFn(upsertAccount);
  const delAcc = useServerFn(deleteAccount);
  const archiveCC = useServerFn(archiveOrDeleteCostCenter);
  const ccs = useQuery({ queryKey: ["admin-cc"], queryFn: () => ccFn() });
  const accs = useQuery({ queryKey: ["admin-acc"], queryFn: () => accFn() });
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["admin-cc"] });
    qc.invalidateQueries({ queryKey: ["admin-acc"] });
    qc.invalidateQueries({ queryKey: ["cc"] });
  };

  return (
    <div className="space-y-4">
      <NewCostCenter onSaved={refresh} />
      {(ccs.data ?? []).map((cc) => {
        const inactive = cc.is_active === false;
        return (
          <Card key={cc.id} className={`p-5 ${inactive ? "opacity-60" : ""}`}>
            <div className="flex items-center gap-2">
              <span className="text-sm font-mono text-muted-foreground w-10">{cc.code}</span>
              <Input
                defaultValue={cc.name}
                onBlur={async (e) => {
                  if (e.target.value === cc.name) return;
                  try { await upsertCC({ data: { id: cc.id, code: cc.code, name: e.target.value, enterprise: cc.enterprise, master_only: cc.master_only, is_active: !inactive } }); toast.success("Salvo"); refresh(); }
                  catch (err) { toast.error(err instanceof Error ? err.message : "Erro"); }
                }}
              />
              <Select value={cc.enterprise} onValueChange={async (v) => {
                try { await upsertCC({ data: { id: cc.id, code: cc.code, name: cc.name, enterprise: v as Enterprise["value"], master_only: cc.master_only, is_active: !inactive } }); toast.success("Empreendimento atualizado"); refresh(); }
                catch (e) { toast.error(e instanceof Error ? e.message : "Erro"); }
              }}>
                <SelectTrigger className="w-[180px]"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {ENTERPRISES.map((e) => <SelectItem key={e.value} value={e.value}>{e.label}</SelectItem>)}
                </SelectContent>
              </Select>
              <Button size="sm" variant="outline" onClick={async () => {
                if (!confirm("Arquivar ou excluir este centro de custo?")) return;
                try {
                  const r = await archiveCC({ data: { id: cc.id } });
                  toast.success(r.deleted ? "Excluído" : "Arquivado (possui histórico)");
                  refresh();
                } catch (e) { toast.error(e instanceof Error ? e.message : "Erro"); }
              }}>
                <Archive className="h-3 w-3 mr-1" />
                Arquivar
              </Button>
              {cc.master_only && <Badge variant="destructive"><Lock className="h-3 w-3 mr-1" />Master</Badge>}
              {inactive && <Badge variant="secondary">Inativo</Badge>}
            </div>
            <div className="mt-4 space-y-2">
              {(accs.data ?? []).filter((a) => a.cost_center_id === cc.id).map((a) => (
                <div key={a.id} className={`flex items-center gap-2 ${a.is_active === false ? "opacity-60" : ""}`}>
                  <Input defaultValue={a.name} onBlur={async (e) => {
                    if (e.target.value === a.name) return;
                    try { await upsertAcc({ data: { id: a.id, cost_center_id: cc.id, name: e.target.value, kind: a.kind, is_active: a.is_active !== false } }); toast.success("Salvo"); refresh(); }
                    catch (err) { toast.error(err instanceof Error ? err.message : "Erro"); }
                  }} />
                  <Badge variant={a.kind === "revenue" ? "default" : "secondary"}>{a.kind === "revenue" ? "Receita" : "Despesa"}</Badge>
                  {a.is_active === false && <Badge variant="outline">Inativa</Badge>}
                  <Button size="icon" variant="ghost" aria-label="Arquivar ou excluir" onClick={async () => {
                    if (!confirm("Arquivar ou excluir esta subcategoria?")) return;
                    try {
                      const r = await delAcc({ data: { id: a.id } });
                      toast.success(r.deleted ? "Excluída" : "Arquivada (possui histórico)");
                      refresh();
                    }
                    catch (err) { toast.error(err instanceof Error ? err.message : "Erro"); }
                  }}><Archive className="h-4 w-4" /></Button>
                </div>
              ))}
              <NewAccountRow ccId={cc.id} onSaved={refresh} />
            </div>
          </Card>
        );
      })}
    </div>
  );
}

function NewCostCenter({ onSaved }: { onSaved: () => void }) {
  const upsertCC = useServerFn(upsertCostCenter);
  const [code, setCode] = useState(10);
  const [name, setName] = useState("");
  const [enterprise, setEnterprise] = useState<Enterprise["value"]>("ghr");
  const [masterOnly, setMasterOnly] = useState(false);
  return (
    <Card className="p-4 flex flex-wrap items-end gap-2">
      <div className="w-20"><Label className="text-xs">Código</Label><Input type="number" value={code} onChange={(e) => setCode(Number(e.target.value))} /></div>
      <div className="flex-1 min-w-[200px]"><Label className="text-xs">Novo Centro de Custo</Label><Input value={name} onChange={(e) => setName(e.target.value)} /></div>
      <div className="w-44">
        <Label className="text-xs">Empreendimento</Label>
        <Select value={enterprise} onValueChange={(v) => setEnterprise(v as Enterprise["value"])}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            {ENTERPRISES.map((e) => <SelectItem key={e.value} value={e.value}>{e.label}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
      <div className="flex items-center gap-2"><Switch checked={masterOnly} onCheckedChange={setMasterOnly} /><Label>Restrito Master</Label></div>
      <Button size="sm" onClick={async () => {
        if (!name) return;
        try { await upsertCC({ data: { code, name, enterprise, master_only: masterOnly, is_active: true } }); toast.success("Criado"); setName(""); onSaved(); }
        catch (e) { toast.error(e instanceof Error ? e.message : "Erro"); }
      }}><Plus className="h-4 w-4 mr-1" />Adicionar</Button>
    </Card>
  );
}

function NewAccountRow({ ccId, onSaved }: { ccId: string; onSaved: () => void }) {
  const upsertAcc = useServerFn(upsertAccount);
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
        try { await upsertAcc({ data: { cost_center_id: ccId, name, kind, is_active: true } }); toast.success("Adicionada"); setName(""); onSaved(); }
        catch (e) { toast.error(e instanceof Error ? e.message : "Erro"); }
      }}><Plus className="h-4 w-4" /></Button>
    </div>
  );
}
