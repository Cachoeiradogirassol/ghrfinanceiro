import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Pencil, Plus, Users } from "lucide-react";
import { AppLayout } from "@/components/AppLayout";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { createContact, listContacts, updateContact } from "@/lib/finance.functions";
import { toast } from "sonner";

export const Route = createFileRoute("/contatos")({
  head: () => ({ meta: [{ title: "Fornecedores e Colaboradores — CONTROLE.GHR" }] }),
  component: () => <AppLayout><ContactsPage /></AppLayout>,
});

type Contact = {
  id: string;
  name: string;
  type: string;
  document_type: string | null;
  document_number: string | null;
  phone: string | null;
};
type FormState = {
  name: string;
  type: "FORNECEDOR" | "COLABORADOR";
  document_type: "PF" | "PJ";
  document_number: string;
  phone: string;
};

const emptyForm: FormState = {
  name: "",
  type: "FORNECEDOR",
  document_type: "PJ",
  document_number: "",
  phone: "",
};

function ContactsPage() {
  const queryClient = useQueryClient();
  const listFn = useServerFn(listContacts);
  const createFn = useServerFn(createContact);
  const updateFn = useServerFn(updateContact);
  const contacts = useQuery({ queryKey: ["contacts"], queryFn: () => listFn() });
  const [editing, setEditing] = useState<Contact | null>(null);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<FormState>(emptyForm);

  useEffect(() => {
    if (!editing) return;
    setForm({
      name: editing.name,
      type: editing.type as FormState["type"],
      document_type: (editing.document_type as FormState["document_type"] | null) ?? "PJ",
      document_number: editing.document_number ?? "",
      phone: editing.phone ?? "",
    });
  }, [editing]);

  const save = useMutation({
    mutationFn: async () => {
      const contact = {
        name: form.name.trim(),
        type: form.type,
        document_type: form.document_number.trim() ? form.document_type : null,
        document_number: form.document_number.trim() || null,
        phone: form.phone.trim() || null,
        master_only: false,
      };
      if (!contact.name) throw new Error("O nome é obrigatório.");
      return editing
        ? updateFn({ data: { id: editing.id, contact } })
        : createFn({ data: contact });
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["contacts"] });
      toast.success(editing ? "Contato atualizado." : "Contato cadastrado.");
      setOpen(false);
      setEditing(null);
      setForm(emptyForm);
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Erro ao salvar contato."),
  });

  const startNew = () => {
    setEditing(null);
    setForm(emptyForm);
    setOpen(true);
  };

  return (
    <div className="p-8 space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold flex items-center gap-2"><Users className="h-6 w-6 text-primary" /> Fornecedores e Colaboradores</h1>
          <p className="text-muted-foreground">Todos os contatos cadastrados na base.</p>
        </div>
        <Button onClick={startNew}><Plus className="mr-2 h-4 w-4" /> Novo contato</Button>
      </div>

      <Card className="p-5">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader><TableRow><TableHead>Nome</TableHead><TableHead>Categoria</TableHead><TableHead>CPF/CNPJ</TableHead><TableHead>Telefone</TableHead><TableHead className="text-right">Ações</TableHead></TableRow></TableHeader>
            <TableBody>
              {(contacts.data ?? []).map((contact) => (
                <TableRow key={contact.id}>
                  <TableCell className="font-medium">{contact.name}</TableCell>
                  <TableCell>{contact.type === "COLABORADOR" ? "Colaborador" : "Fornecedor"}</TableCell>
                  <TableCell>{contact.document_number || "—"}</TableCell>
                  <TableCell>{contact.phone || "—"}</TableCell>
                  <TableCell className="text-right"><Button size="sm" variant="outline" onClick={() => { setEditing(contact); setOpen(true); }}><Pencil className="mr-1 h-3.5 w-3.5" /> Editar</Button></TableCell>
                </TableRow>
              ))}
              {!contacts.isLoading && !contacts.data?.length && <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground">Nenhum contato cadastrado.</TableCell></TableRow>}
            </TableBody>
          </Table>
        </div>
      </Card>

      <Dialog open={open} onOpenChange={(next) => { setOpen(next); if (!next) setEditing(null); }}>
        <DialogContent>
          <DialogHeader><DialogTitle>{editing ? "Editar contato" : "Novo contato"}</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div><Label>Nome *</Label><Input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} /></div>
            <div><Label>Categoria</Label><Select value={form.type} onValueChange={(value) => setForm({ ...form, type: value as FormState["type"] })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="FORNECEDOR">Fornecedor</SelectItem><SelectItem value="COLABORADOR">Colaborador / Sócio</SelectItem></SelectContent></Select></div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div><Label>Tipo de documento (opcional)</Label><Select value={form.document_type} onValueChange={(value) => setForm({ ...form, document_type: value as FormState["document_type"] })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="PF">CPF</SelectItem><SelectItem value="PJ">CNPJ</SelectItem></SelectContent></Select></div>
              <div><Label>{form.document_type === "PF" ? "CPF" : "CNPJ"} (opcional)</Label><Input value={form.document_number} onChange={(event) => setForm({ ...form, document_number: event.target.value })} /></div>
            </div>
            <div><Label>Telefone (opcional)</Label><Input type="tel" value={form.phone} onChange={(event) => setForm({ ...form, phone: event.target.value })} /></div>
          </div>
          <DialogFooter><Button variant="outline" onClick={() => setOpen(false)}>Cancelar</Button><Button onClick={() => save.mutate()} disabled={!form.name.trim() || save.isPending}>{save.isPending ? "Salvando..." : "Salvar"}</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}