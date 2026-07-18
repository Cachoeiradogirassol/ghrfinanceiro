## Objetivo

No **Step 3 — Conciliar** do Importador Open Finance, além das ações existentes (`match`, `create`, `aporte`, `skip`), permitir a ação **`sales_batch`**: vincular entradas de cartão/PIX diretamente a um **lote de venda consolidada aberto** (`sales_batches`) do centro de custo correspondente, abatendo `received_amount` — em vez de criar cada movimento como transação avulsa.

## Comportamento

- Entradas (`valor > 0`) cujo banco pertence a uma **enterprise** com **lote(s) de venda `status='open'`** dentro de uma janela de ±31 dias em torno da data do movimento passam a exibir a opção **"Vincular a lote de venda"** com um seletor dos lotes candidatos (mostrando CC + data de referência + saldo restante: `gross_total − received_amount`).
- Essas linhas ganham destaque visual (badge "Lote aberto disponível") para que o operador priorize a vinculação em vez de criar um lançamento novo.
- Ao vincular, **não** é criada uma `transactions`. Cria-se uma `bank_statement_lines` com `sales_batch_id` preenchido, `reconciled=true`. O trigger `trg_bsl_sales_batch_sync` já existente recalcula `received_amount` do lote.
- Deduplicação: uma linha só pode ser vinculada uma vez. A `of_dedupe_key` passa a ser gravada também em `bank_statement_lines`, e o parser (Step 1) checa duplicatas tanto em `transactions` quanto em `bank_statement_lines`.
- Aportes, criações e conciliações continuam funcionando como hoje. Se o operador ignorar a sugestão de lote e escolher `create`, o comportamento antigo é mantido.

## Alterações técnicas

### 1) Migração (SQL)

- `ALTER TABLE public.bank_statement_lines ADD COLUMN of_dedupe_key text;`
- Índice `idx_bsl_of_dedupe_key` em `of_dedupe_key WHERE of_dedupe_key IS NOT NULL`.

### 2) `src/lib/openfinance-import.functions.ts`

- **Dedupe do Step 1 (`parseOpenFinanceText`)**: além do `SELECT of_dedupe_key FROM transactions`, também consultar `bank_statement_lines.of_dedupe_key` e unir os conjuntos ao aplicar o filtro de duplicatas.
- **Sugestão de lotes**: para cada item de entrada com `bank_account_id` resolvido, buscar `sales_batches` com `status='open'`, `cost_centers.enterprise = bank_account.enterprise` e `reference_date BETWEEN data-31 AND data+31`. Anexar `sales_batch_candidates: [{id, cost_center_id, cost_center_name, reference_date, gross_total, remaining}]` a cada item retornado.
- **Schema `DecisionSchema`**: adicionar `action: "sales_batch"` e `sales_batch_id: z.string().uuid().nullable().optional()`.
- **Handler `confirmOpenFinanceImport`**: novo ramo para `action === "sales_batch"`:
  - Validar `sales_batch_id`, `bank_account_id`, `valor > 0`.
  - Dedupe: `bank_statement_lines` onde `of_dedupe_key = dec.of_dedupe_key`.
  - `INSERT` em `bank_statement_lines` com `bank_account_id`, `statement_date=data`, `amount=|valor|`, `description` (incluindo tag + descrição), `sales_batch_id`, `reconciled=true`, `matched_by=userId`, `matched_at=now()`, `of_dedupe_key`.
  - Contador novo: `attached_to_batch` no retorno.

### 3) `src/components/OpenFinanceImporter.tsx`

- Tipo `ParsedItem` recebe `sales_batch_candidates` opcional.
- Estado de decisão por linha: acrescentar `sales_batch_id` e permitir `action='sales_batch'`.
- Renderização Step 3:
  - Para linhas com `sales_batch_candidates.length > 0` e `valor > 0`, mostrar badge "Lote aberto disponível" e ordenar essas linhas primeiro dentro do bloco de categoria.
  - Radio group da linha ganha 4ª opção **"Vincular a lote"** com `<Select>` dos candidatos (formato: `"CC · dd/mm · restante R$ X"`).
  - Ao mudar para `sales_batch`, defaultar `sales_batch_id` ao primeiro candidato.
- Toast final: incluir `attached_to_batch` no resumo.

## Fora de escopo

- Não alterar o fluxo de fechamento de lote (`closeSalesBatch`) nem apuração de taxas.
- Não mudar Steps 1 e 2 além da dedupe adicional e do enriquecimento com candidatos de lote.
- Não expor lotes já fechados.

## Diagrama do fluxo

```text
Step 3 — linha de ENTRADA em banco com lote aberto no CC:

  ┌──────────────────────────────────────────────┐
  │ [x] Vincular a lote  ▸ [Lote CC-JK · 15/07 · restante R$ 4.320] │
  │ ( ) Conciliar 1-para-1                        │
  │ ( ) Criar lançamento novo                     │
  │ ( ) Ignorar                                   │
  └──────────────────────────────────────────────┘
            │
            ▼
  INSERT bank_statement_lines(sales_batch_id=…, reconciled=true)
            │
            ▼
  trigger trg_bsl_sales_batch_sync → UPDATE sales_batches.received_amount
```
