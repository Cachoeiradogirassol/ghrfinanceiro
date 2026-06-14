import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { PluggyConnect } from "react-pluggy-connect";
import { Landmark, Loader2, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { createPluggyToken, completePluggyConnection } from "@/lib/pluggy.functions";
import { useAuth } from "@/lib/auth";
import { toast } from "sonner";

type Bank = {
  id: string;
  name: string;
  pluggy_account_id?: string | null;
};

export function PluggyConnection({ banks, onConnected }: { banks: Bank[]; onConnected: () => void }) {
  const { isMaster } = useAuth();
  const tokenFn = useServerFn(createPluggyToken);
  const completeFn = useServerFn(completePluggyConnection);
  const [bankId, setBankId] = useState("");
  const [token, setToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const openWidget = async () => {
    if (!bankId) return toast.error("Selecione a conta bancária do sistema.");
    setLoading(true);
    try {
      const result = await tokenFn();
      setToken(result.connectToken);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Não foi possível iniciar o Pluggy.");
    } finally {
      setLoading(false);
    }
  };

  const onSuccess = async (payload: { item: { id: string } }) => {
    const itemId = payload.item?.id;
    if (!itemId || !bankId) return;
    setLoading(true);
    try {
      const result = await completeFn({ data: { bank_account_id: bankId, item_id: itemId } });
      toast.success(`Open Finance conectado a ${result.accountName}.`);
      setToken(null);
      onConnected();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Falha ao vincular a conta.");
    } finally {
      setLoading(false);
    }
  };

  if (!isMaster) return null;

  return (
    <Card className="p-5 md:col-span-2">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <h3 className="flex items-center gap-2 font-semibold">
            <Landmark className="h-4 w-4 text-primary" /> Open Finance com Pluggy
          </h3>
          <p className="max-w-2xl text-sm text-muted-foreground">
            Conecte Mercado Pago, Banco Inter ou C6 Bank para importar movimentações liquidadas e preparar a conciliação semanal.
          </p>
        </div>
        <Badge variant="outline" className="gap-1"><ShieldCheck className="h-3 w-3" /> Credenciais protegidas</Badge>
      </div>
      <div className="mt-4 flex flex-wrap items-end gap-3">
        <div className="min-w-72 space-y-1">
          <Label>Conta correspondente no CONTROLE.GHR</Label>
          <Select value={bankId} onValueChange={setBankId}>
            <SelectTrigger><SelectValue placeholder="Selecione a conta" /></SelectTrigger>
            <SelectContent>
              {banks.map((bank) => (
                <SelectItem key={bank.id} value={bank.id}>
                  {bank.name}{bank.pluggy_account_id ? " • conectada" : ""}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <Button onClick={openWidget} disabled={loading || !bankId}>
          {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Landmark className="mr-2 h-4 w-4" />}
          Conectar Conta via Open Finance (Pluggy)
        </Button>
      </div>
      {token && (
        <PluggyConnect
          connectToken={token}
          onSuccess={onSuccess}
          onClose={() => setToken(null)}
          onError={(error) => {
            toast.error(error.message || "A conexão Pluggy foi interrompida.");
          }}
          onLoadError={() => {
            toast.error("Não foi possível carregar o widget Pluggy.");
          }}
        />
      )}
    </Card>
  );
}