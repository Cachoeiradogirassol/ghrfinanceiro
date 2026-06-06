import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { AppLayout } from "@/components/AppLayout";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  listCostCenters,
  listAccounts,
  listBankAccounts,
  createTransaction,
  listContacts,
  createContact,
} from "@/lib/finance.functions";
import { useState, useMemo } from "react";
import { Card } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  RadioGroup,
  RadioGroupItem,
} from "@/components/ui/radio-group";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { toast } from "sonner";
import { Layers, AlertTriangle, Search, UserPlus } from "lucide-react";

export const Route = createFileRoute("/lancamentos/novo")({
  head: () => ({ meta: [{ title: "Novo Lançamento — CONTROLE.GHR" }] }),
  component: () => (
    <AppLayout>
      <Form />
    </AppLayout>
  ),
});

// Keywords that mark a category as "payment-only" (no nota fiscal physical purchase)
const PAYMENT_ONLY_KEYWORDS = [
  "equipe",
  "gps",
  "fgts",
  "simples",
  "pró-labore",
  "pro-labore",
  "imposto",
  "honorário",
  "honorario",
  "adiantamento",
  "luz",
  "internet",
  "telefone",
];

function isPaymentOnlyCategory(accountName?: string) {
  if (!accountName) return false;
  const n = accountName.toLowerCase();
  return PAYMENT_ONLY_KEYWORDS.some((k) => n.includes(k));
}

function Form() {
  const ccFn = useServerFn(listCostCenters);
  const accFn = useServerFn(listAccounts);
  const bkFn = useServerFn(listBankAccounts);
  const contactsFn = useServerFn(listContacts);
  const createContactFn = useServerFn(createContact);
  const createFn = useServerFn(createTransaction);
  const nav = useNavigate();
  const qc = useQueryClient();

  const ccs = useQuery({ queryKey: ["cc"], queryFn: () => ccFn() });
  const accs = useQuery({ queryKey: ["acc"], queryFn: () => accFn() });
  const banks = useQuery({ queryKey: ["banks"], queryFn: () => bkFn() });
  const contacts = useQuery({ queryKey: ["contacts"], queryFn: () => contactsFn() });

  const [type, setType] = useState<"payable" | "receivable">("payable");
  const [costCenterId, setCostCenterId] = useState("");
  const [accountId, setAccountId] = useState("");
  const [bankId, setBankId] = useState<string>("");
  const [paymentMethod, setPaymentMethod] = useState<string>("");
  const [amount, setAmount] = useState("");
  const [description, setDescription] = useState("");
  const [docDt, setDocDt] = useState("");
  const [dueDate, setDueDate] = useState(
    new Date().toISOString().slice(0, 10),
  );
  const [isBatch, setIsBatch] = useState(false);
  const [status, setStatus] = useState<"pending" | "paid">("pending");

  // Rateio
  const [rateio, setRateio] = useState(false);
  const [splits, setSplits] = useState<Record<string, string>>({}); // cost_center_id -> amount string

  // Schedule
  const [scheduleKind, setScheduleKind] = useState<"single" | "installment" | "recurring">("single");
  const [installments, setInstallments] = useState("2");
  const [recurringMonths, setRecurringMonths] = useState("12");

  // Contact
  const [contactSearch, setContactSearch] = useState("");
  const [contactId, setContactId] = useState<string>("");
  const [showNewContact, setShowNewContact] = useState(false);
  const [newDocType, setNewDocType] = useState<"PF" | "PJ">("PF");
  const [newDoc, setNewDoc] = useState("");
  const [newContactType, setNewContactType] = useState<"FORNECEDOR" | "COLABORADOR">("FORNECEDOR");
  const [duplicateAlert, setDuplicateAlert] = useState<string | null>(null);

  const filteredAccounts = useMemo(
    () => (accs.data ?? []).filter((a) => a.cost_center_id === costCenterId),
    [accs.data, costCenterId],
  );

  const selectedAccount = useMemo(
    () => (accs.data ?? []).find((a) => a.id === accountId),
    [accs.data, accountId],
  );
  const paymentOnly = isPaymentOnlyCategory(selectedAccount?.name);
  const docDtLabel = paymentOnly ? "Data/Hora do Pagamento" : "Data/Hora da Nota";
  const docDtRequired = !paymentOnly || status === "paid";

  const filteredContacts = useMemo(() => {
    const q = contactSearch.trim().toLowerCase();
    if (!q) return (contacts.data ?? []).slice(0, 8);
    return (contacts.data ?? [])
      .filter(
        (c) =>
          c.name.toLowerCase().includes(q) ||
          c.document_number.includes(q.replace(/\D/g, "")),
      )
      .slice(0, 8);
  }, [contacts.data, contactSearch]);

  const selectedContact = useMemo(
    () => (contacts.data ?? []).find((c) => c.id === contactId),
    [contacts.data, contactId],
  );

  // Active cost centers grouped by enterprise (for rateio)
  const activeCCs = useMemo(
    () => (ccs.data ?? []).filter((c) => c.is_active !== false),
    [ccs.data],
  );

  const splitTotal = useMemo(
    () =>
      Object.values(splits).reduce((s, v) => s + (parseFloat(v) || 0), 0),
    [splits],
  );
  const totalAmount = parseFloat(amount) || 0;
  const splitOk =
    !rateio || (totalAmount > 0 && Math.abs(splitTotal - totalAmount) < 0.01);

  // Aporte cruzado detection
  const selectedBank = useMemo(
    () => (banks.data ?? []).find((b) => b.id === bankId),
    [banks.data, bankId],
  );
  const selectedCC = useMemo(
    () => (ccs.data ?? []).find((c) => c.id === costCenterId),
    [ccs.data, costCenterId],
  );
  const aporteCruzado =
    selectedBank &&
    selectedCC &&
    selectedBank.enterprise &&
    selectedCC.enterprise &&
    selectedBank.enterprise !== selectedCC.enterprise &&
    !rateio;

  function distributeEqually() {
    const ids = Object.keys(splits).filter((id) => splits[id] !== undefined);
    if (ids.length === 0 || !totalAmount) return;
    const each = (totalAmount / ids.length).toFixed(2);
    const next: Record<string, string> = {};
    ids.forEach((id) => (next[id] = each));
    setSplits(next);
  }

  function toggleSplit(id: string, on: boolean) {
    setSplits((prev) => {
      const next = { ...prev };
      if (on) next[id] = "";
      else delete next[id];
      return next;
    });
  }

  const contactMut = useMutation({
    mutationFn: () =>
      createContactFn({
        data: {
          name: contactSearch.trim(),
          type: newContactType,
          document_type: newDocType,
          document_number: newDoc,
          master_only: false,
        },
      }),
    onSuccess: (row) => {
      toast.success("Contato cadastrado");
      setContactId(row.id);
      setShowNewContact(false);
      setNewDoc("");
      setDuplicateAlert(null);
      qc.invalidateQueries({ queryKey: ["contacts"] });
    },
    onError: (e) => {
      const msg = e instanceof Error ? e.message : "Erro";
      if (msg.startsWith("Atenção:")) {
        setDuplicateAlert(msg);
      } else {
        toast.error(msg);
      }
    },
  });

  const mut = useMutation({
    mutationFn: () => {
      const allocations = rateio
        ? Object.entries(splits)
            .filter(([, v]) => parseFloat(v) > 0)
            .map(([cc, v]) => ({
              cost_center_id: cc,
              amount: parseFloat(v),
              percent: totalAmount ? (parseFloat(v) / totalAmount) * 100 : null,
            }))
        : undefined;
      return createFn({
        data: {
          cost_center_id: costCenterId,
          account_id: accountId,
          bank_account_id: bankId || null,
          contact_id: contactId,
          type,
          amount: parseFloat(amount),
          description: description || null,
          document_datetime: docDt ? new Date(docDt).toISOString() : null,
          due_date: dueDate,
          is_batch: isBatch,
          status,
          payment_method: (paymentMethod || null) as
            | "pix"
            | "boleto"
            | "credit_card"
            | "cash"
            | null,
          allocations,
          schedule:
            scheduleKind === "installment"
              ? { kind: "installment", installments: parseInt(installments, 10) }
              : scheduleKind === "recurring"
                ? { kind: "recurring", recurring_months: parseInt(recurringMonths, 10) }
                : { kind: "single" },
        },
      });
    },
    onSuccess: () => {
      toast.success("Lançamento criado");
      nav({ to: "/lancamentos" });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Erro"),
  });

  const canSave =
    costCenterId &&
    accountId &&
    contactId &&
    amount &&
    (!docDtRequired || docDt) &&
    splitOk &&
    !mut.isPending;

  return (
    <div className="p-8 max-w-3xl">
      <h1 className="text-3xl font-bold mb-6">Novo Lançamento</h1>
      <Card className="p-6 space-y-5">
        <div>
          <Label>Tipo</Label>
          <RadioGroup
            value={type}
            onValueChange={(v) => setType(v as "payable" | "receivable")}
            className="flex gap-6 mt-2"
          >
            <div className="flex items-center gap-2">
              <RadioGroupItem value="payable" id="r1" />
              <Label htmlFor="r1">Conta a Pagar</Label>
            </div>
            <div className="flex items-center gap-2">
              <RadioGroupItem value="receivable" id="r2" />
              <Label htmlFor="r2">Conta a Receber</Label>
            </div>
          </RadioGroup>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <Label>Bloco (Centro de Custo)</Label>
            <Select value={costCenterId} onValueChange={setCostCenterId}>
              <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
              <SelectContent>
                {(ccs.data ?? []).map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.code} - {c.name}
                    {c.master_only && " 🔒"}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Subcategoria</Label>
            <Select
              value={accountId}
              onValueChange={setAccountId}
              disabled={!costCenterId}
            >
              <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
              <SelectContent>
                {filteredAccounts.map((a) => (
                  <SelectItem key={a.id} value={a.id}>
                    {a.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* Contact / Beneficiário */}
        <div className="space-y-2">
          <Label>Fornecedor / Beneficiário *</Label>
          {selectedContact ? (
            <div className="flex items-center justify-between p-3 rounded-md border bg-muted/30">
              <div>
                <div className="font-medium">{selectedContact.name}</div>
                <div className="text-xs text-muted-foreground">
                  {selectedContact.type} · {selectedContact.document_type} ·{" "}
                  {selectedContact.document_number}
                </div>
              </div>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  setContactId("");
                  setContactSearch("");
                }}
              >
                Trocar
              </Button>
            </div>
          ) : (
            <div className="relative">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  className="pl-9"
                  placeholder="Digite nome ou CPF/CNPJ..."
                  value={contactSearch}
                  onChange={(e) => {
                    setContactSearch(e.target.value);
                    setShowNewContact(false);
                    setDuplicateAlert(null);
                  }}
                />
              </div>
              {contactSearch && !showNewContact && (
                <div className="mt-2 border rounded-md max-h-56 overflow-auto bg-popover">
                  {filteredContacts.map((c) => (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => {
                        setContactId(c.id);
                        setContactSearch("");
                      }}
                      className="w-full text-left px-3 py-2 hover:bg-accent text-sm"
                    >
                      <div className="font-medium">{c.name}</div>
                      <div className="text-xs text-muted-foreground">
                        {c.type} · {c.document_number}
                      </div>
                    </button>
                  ))}
                  <button
                    type="button"
                    onClick={() => setShowNewContact(true)}
                    className="w-full text-left px-3 py-2 hover:bg-accent text-sm border-t flex items-center gap-2"
                  >
                    <UserPlus className="h-4 w-4" />
                    Cadastrar "{contactSearch}" como novo contato
                  </button>
                </div>
              )}
              {showNewContact && (
                <Card className="mt-2 p-4 space-y-3 bg-muted/30">
                  <div className="text-sm font-medium">
                    Novo contato: {contactSearch}
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <Label className="text-xs">Categoria</Label>
                      <Select
                        value={newContactType}
                        onValueChange={(v) =>
                          setNewContactType(v as "FORNECEDOR" | "COLABORADOR")
                        }
                      >
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="FORNECEDOR">Fornecedor</SelectItem>
                          <SelectItem value="COLABORADOR">
                            Colaborador / Sócio
                          </SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <Label className="text-xs">Tipo de documento</Label>
                      <Select
                        value={newDocType}
                        onValueChange={(v) => {
                          setNewDocType(v as "PF" | "PJ");
                          setNewDoc("");
                          setDuplicateAlert(null);
                        }}
                      >
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="PF">CPF (Pessoa Física)</SelectItem>
                          <SelectItem value="PJ">CNPJ (Pessoa Jurídica)</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  <div>
                    <Label className="text-xs">
                      {newDocType === "PF" ? "CPF *" : "CNPJ *"}
                    </Label>
                    <Input
                      placeholder={
                        newDocType === "PF"
                          ? "000.000.000-00"
                          : "00.000.000/0000-00"
                      }
                      value={newDoc}
                      onChange={(e) => {
                        setNewDoc(e.target.value);
                        setDuplicateAlert(null);
                      }}
                    />
                  </div>
                  {duplicateAlert && (
                    <Alert variant="destructive">
                      <AlertTriangle className="h-4 w-4" />
                      <AlertDescription>{duplicateAlert}</AlertDescription>
                    </Alert>
                  )}
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      onClick={() => contactMut.mutate()}
                      disabled={
                        !contactSearch.trim() ||
                        !newDoc.trim() ||
                        contactMut.isPending
                      }
                    >
                      {contactMut.isPending ? "Salvando..." : "Cadastrar contato"}
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setShowNewContact(false)}
                    >
                      Cancelar
                    </Button>
                  </div>
                </Card>
              )}
            </div>
          )}
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <Label>Valor (R$)</Label>
            <Input
              type="number"
              step="0.01"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
          </div>
          <div>
            <Label>Conta Bancária</Label>
            <Select value={bankId} onValueChange={setBankId}>
              <SelectTrigger><SelectValue placeholder="Opcional" /></SelectTrigger>
              <SelectContent>
                {(banks.data ?? []).map((b) => (
                  <SelectItem key={b.id} value={b.id}>
                    {b.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <Label>Forma de Pagamento</Label>
            <Select value={paymentMethod} onValueChange={setPaymentMethod}>
              <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="pix">Pix</SelectItem>
                <SelectItem value="boleto">Boleto</SelectItem>
                <SelectItem value="credit_card">Cartão de Crédito</SelectItem>
                <SelectItem value="cash">Dinheiro Físico</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Status</Label>
            <Select value={status} onValueChange={(v) => setStatus(v as "pending" | "paid")}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="pending">Pendente</SelectItem>
                <SelectItem value="paid">Pago</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <Label>
              {docDtLabel}
              {docDtRequired ? " *" : " (opcional)"}
            </Label>
            <Input
              type="datetime-local"
              value={docDt}
              onChange={(e) => setDocDt(e.target.value)}
            />
            {paymentOnly && (
              <p className="text-xs text-muted-foreground mt-1">
                Categoria de pagamento — obrigatório apenas quando o status for "Pago".
              </p>
            )}
          </div>
          <div>
            <Label>Vencimento</Label>
            <Input
              type="date"
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
            />
          </div>
        </div>

        <div>
          <Label>Descrição</Label>
          <Textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Ex: Equipe Terceirizada — pagamento semanal"
          />
        </div>

        {/* Aporte cruzado */}
        {aporteCruzado && (
          <Alert>
            <AlertTriangle className="h-4 w-4" />
            <AlertDescription>
              <strong>Aporte cruzado detectado:</strong> a conta bancária pertence a um empreendimento diferente do Centro de Custo. O sistema registrará automaticamente este pagamento como Aporte Concedido pelo banco e Aporte Recebido pelo CC nas DREs.
            </AlertDescription>
          </Alert>
        )}

        {/* Rateio */}
        <div className="space-y-3 p-3 rounded-md border bg-muted/20">
          <label className="flex items-center gap-3 cursor-pointer">
            <Checkbox checked={rateio} onCheckedChange={(c) => { setRateio(Boolean(c)); if (!c) setSplits({}); }} />
            <span className="text-sm font-medium">Ratear esta despesa entre múltiplos centros de custo</span>
          </label>
          {rateio && (
            <div className="space-y-2 pl-7">
              <p className="text-xs text-muted-foreground">
                Selecione os centros, defina valores (R$) ou clique em "Dividir por igual".
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {activeCCs.map((cc) => {
                  const active = splits[cc.id] !== undefined;
                  return (
                    <div key={cc.id} className="flex items-center gap-2 p-2 border rounded">
                      <Checkbox
                        checked={active}
                        onCheckedChange={(v) => toggleSplit(cc.id, Boolean(v))}
                      />
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-medium truncate">{cc.code} - {cc.name}</p>
                      </div>
                      <Input
                        type="number"
                        step="0.01"
                        className="w-24 h-8 text-xs"
                        placeholder="R$"
                        disabled={!active}
                        value={splits[cc.id] ?? ""}
                        onChange={(e) => setSplits((p) => ({ ...p, [cc.id]: e.target.value }))}
                      />
                    </div>
                  );
                })}
              </div>
              <div className="flex items-center justify-between gap-2 pt-2 border-t">
                <Button type="button" size="sm" variant="outline" onClick={distributeEqually}>
                  Dividir por igual
                </Button>
                <div className={`text-xs font-mono ${splitOk ? "text-primary" : "text-destructive"}`}>
                  Soma: R$ {splitTotal.toFixed(2)} / R$ {totalAmount.toFixed(2)}
                  {!splitOk && totalAmount > 0 && " — não fecha!"}
                </div>
              </div>
            </div>
          )}
        </div>


        <div className="space-y-3 p-3 rounded-md border bg-muted/20">
          <Label>Conta Parcelada ou Recorrente</Label>
          <RadioGroup
            value={scheduleKind}
            onValueChange={(v) =>
              setScheduleKind(v as "single" | "installment" | "recurring")
            }
            className="grid grid-cols-3 gap-2"
          >
            <div className="flex items-center gap-2">
              <RadioGroupItem value="single" id="sk-s" />
              <Label htmlFor="sk-s" className="font-normal">Única</Label>
            </div>
            <div className="flex items-center gap-2">
              <RadioGroupItem value="installment" id="sk-i" />
              <Label htmlFor="sk-i" className="font-normal">Parcelada</Label>
            </div>
            <div className="flex items-center gap-2">
              <RadioGroupItem value="recurring" id="sk-r" />
              <Label htmlFor="sk-r" className="font-normal">Recorrente (mensal)</Label>
            </div>
          </RadioGroup>
          {scheduleKind === "installment" && (
            <div className="max-w-xs">
              <Label className="text-xs">Quantidade de Parcelas</Label>
              <Input
                type="number"
                min="2"
                max="120"
                value={installments}
                onChange={(e) => setInstallments(e.target.value)}
              />
              <p className="text-xs text-muted-foreground mt-1">
                Serão geradas {installments || 0} transações com vencimentos a cada 30 dias.
              </p>
            </div>
          )}
          {scheduleKind === "recurring" && (
            <div className="max-w-xs">
              <Label className="text-xs">Provisionar por quantos meses?</Label>
              <Input
                type="number"
                min="1"
                max="36"
                value={recurringMonths}
                onChange={(e) => setRecurringMonths(e.target.value)}
              />
            </div>
          )}
        </div>

        <label className="flex items-start gap-3 p-3 rounded-md border border-border bg-muted/30 cursor-pointer">
          <Checkbox
            checked={isBatch}
            onCheckedChange={(c) => setIsBatch(Boolean(c))}
          />
          <div>
            <span className="text-sm font-medium flex items-center gap-2">
              <Layers className="h-4 w-4" />
              Este pagamento será fracionado no banco (Lote)
            </span>
            <p className="text-xs text-muted-foreground mt-1">
              Permite conciliar este lançamento contra múltiplas saídas
              menores no extrato bancário.
            </p>
          </div>
        </label>

        <div className="flex gap-2">
          <Button onClick={() => mut.mutate()} disabled={!canSave}>
            {mut.isPending ? "Salvando..." : "Salvar"}
          </Button>
          <Button variant="outline" onClick={() => nav({ to: "/lancamentos" })}>
            Cancelar
          </Button>
        </div>
      </Card>
    </div>
  );
}
