## Objetivo

Reorganizar o Importador Open Finance em um assistente linear de 3 steps (Extrair → Categorizar → Conciliar), com deduplicação robusta e sem risco do operador finalizar sem passar pela conciliação. Sem tocar em partes fora do importador/conciliação.

Escopo: `src/lib/openfinance-import.functions.ts`, `src/components/OpenFinanceImporter.tsx`, uma migration curta de schema para a chave de dedupe. `BatchManualReconcilePanel` é reaproveitado dentro do Step 3.

---

## 1) Dedupe robusta (base)

**Chave:** `(statement_date, abs(amount) arredondado a 2 casas, bank_account_id, occurrence_idx)`
- `occurrence_idx` = n-ésima ocorrência daquela tripla `(data, valor, banco)` dentro do próprio extrato (0, 1, 2…), o que preserva pagamentos legítimos idênticos no mesmo dia.

**Persistência (migration nova):**
```sql
ALTER TABLE public.transactions
  ADD COLUMN of_dedupe_key text;             -- "YYYY-MM-DD|123.45|<uuid>|0"
CREATE INDEX ix_transactions_of_dedupe_key
  ON public.transactions(of_dedupe_key)
  WHERE of_dedupe_key IS NOT NULL;
```
Sem NOT NULL — só transações vindas do importador preenchem. Grants não mudam (coluna nova em tabela existente).

**Compatibilidade retroativa:** manter o parsing da tag `[OFIMP]` antiga como fallback secundário — se uma tx antiga não tiver `of_dedupe_key` mas tiver `[OFIMP <fingerprint>]` na descrição e a chave corresponder ao mesmo `(data|valor|banco)`, tratar como duplicata. Nenhum backfill obrigatório.

**Ao gerar as chaves no parser:** ordenar as transações do extrato por data/ordem original antes de atribuir `occurrence_idx`, para o cálculo ser determinístico.

---

## 2) Arquitetura em 3 Steps

### Step 1 — Extrair & checar duplicatas (sem IA)
- Parser determinístico atual roda igual.
- Depois: consultar `transactions` no range `[minDate-1, maxDate+1]` do extrato, filtrando pelas `bank_account_id` candidatas, e comparar por `of_dedupe_key` (com fallback OFIMP).
- Retornar `{ movements: [...], duplicates: [...], newItems: [...] }` com resumo `"X encontrados • Y duplicatas • Z novos"`.
- Lista de duplicatas expansível para o operador ver o quê foi ignorado.
- Botão "Avançar para categorização" só habilita se `Z > 0` (ou permite finalizar cedo com toast "nada novo a importar").

### Step 2 — Categorizar agrupado
- Sobre os `newItems`: aplica o de-para determinístico (existente) e a IA em lote paralela (existente, `gemini-3-flash-preview`, `CONCURRENCY = 8`).
- Agrupar o resultado por `account_id` (ou "Sem categoria"): `Accordion` shadcn com contagem e soma por grupo.
- Cada grupo permite:
  - Reclassificar em massa (dropdown de conta contábil → aplica a todas as linhas do grupo selecionadas).
  - Editar linha a linha (conta contábil + centro de custo).
- Bloquear "Avançar" enquanto existir linha com `account_id = null` (sem categoria).
- Preservar `source` (`map`/`ai`/`manual`) para telemetria no toast final.

### Step 3 — Conciliar (a etapa obrigatória)
- **Auto-match**: para cada movimento novo, tentar casar 1↔1 com `transactions.pending` no range ±3 dias, `abs(diff) ≤ 0.01`, natureza compatível. Mostrar lista de casamentos automáticos com checkbox (operador pode desmarcar).
- **Manual em lote (duas colunas)**: reuso do padrão do `BatchManualReconcilePanel` — lançamentos pendentes à esquerda, movimentos novos do extrato à direita, com "soma confere ±0,01".
- **Aporte / same-person-transfer**: mantém o tratamento existente (pares detectados no parser continuam marcados como `aporte`/`aporte_incomplete`; no confirm, se enterprises do banco vs. CC divergem e o par é legítimo, dispara a trigger de `intercompany_transfers`).
- **Não-conciliados**: para cada movimento restante, exigir decisão explícita: `[Conciliar manualmente]` (abre seletor) ou `[Criar sem conciliar]` (marca-flag). Contador "Faltam N movimentos" visível. Botão "Finalizar" desabilitado enquanto `N > 0`.
- **Finalizar importação** (única gravação):
  - Insere as novas `transactions` com `of_dedupe_key`, `account_id`, `cost_center_id`, `bank_account_id`, categoria da IA/de-para, status inicial correto (`reconciled` se auto/manual match, senão `pending`).
  - Aplica conciliações (marca `reconciled` na tx existente + na `bank_statement_lines` correspondente quando houver).
  - Aportes deixam a trigger `sync_transaction_intercompany` fazer o resto.
  - Resumo final: `N criados • N conciliados • N aportes • total entradas R$X • saídas R$Y`.

### UI geral
- `Stepper` no topo (`1 Extrair › 2 Categorizar › 3 Conciliar`) com estado atual destacado; setas ↤ para voltar (sem perder dados coletados nos steps anteriores — estado em `useReducer` local ao componente).
- Cada step é um subcomponente dentro de `OpenFinanceImporter.tsx` para manter escopo.

---

## 3) Mudanças no backend (`openfinance-import.functions.ts`)

Substituir a atual `parseOpenFinanceText` + `confirmOpenFinanceImport` por:

1. `parseOpenFinanceText(text, bank_account_id)` → agora retorna `{ movements, duplicates, transferPairs }` (sem tocar em DB salvo o `SELECT` de dedupe). Sem IA aqui.
2. `categorizeOpenFinanceItems(items)` → roda de-para + IA em lote paralela, devolve items com `account_id`, `source`, `confidence`. Extraído da função atual.
3. `autoMatchOpenFinanceItems(items)` → devolve sugestões de match 1↔1 com txs pendentes.
4. `confirmOpenFinanceImport(payload)` → recebe o plano final já revisado (creates, matches, batchMatches, aportes, criadosSemConciliar) e faz a gravação atômica.

Reaproveita internamente `CATEGORY_MAP`, `isSamePersonTransfer`, `pairSamePersonTransfers`, lógica de aporte, e o guard "conta contendo 'aporte' só se enterprises divergentes".

---

## 4) O que NÃO muda

- Regras de aporte, trigger `sync_transaction_intercompany`, `intercompany_transfers`.
- `finance.functions.ts` inteiro (o `batchManualReconcile` já está pronto e é reaproveitado como referência de padrão — o Step 3 grava direto na finalização, não chama esse RPC).
- Rota `/conciliacao` (o painel manual em lote continua vivo lá para fluxo fora do importador).
- Vendas, Pluggy connect, upload PDF/CSV.

---

## 5) Riscos e mitigações

- **Perda de estado ao trocar de step**: `useReducer` local no componente; nada gravado no DB até o Finalizar.
- **Extrato de 500 linhas**: parser é O(n); IA já é paralela em ondas de 8×40; render usa virtualization simples (limitar `max-h` + overflow-auto, sem lista virtual pesada — 500 rows cabe).
- **Chave de dedupe colidir**: `occurrence_idx` calculado por `(data, valor, banco)` isolado resolve identidade real de duplicata vs. transações legítimas idênticas.
- **Aportes já existentes**: mantidos como estão; a única mudança é a nova coluna `of_dedupe_key`.

---

## Entregáveis

1. Migration: `of_dedupe_key` + índice.
2. `src/lib/openfinance-import.functions.ts` reestruturado em 4 server fns.
3. `src/components/OpenFinanceImporter.tsx` reescrito como stepper de 3 steps.
4. Sem mudanças em `finance.functions.ts` nem em `conciliacao.tsx` (a não ser eventual ajuste mínimo se o import mudar de assinatura — que não vai mudar; as fns novas convivem).

Ao aprovar, implemento na sequência: migration → backend → UI.