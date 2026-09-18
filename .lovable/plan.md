# Plano — GHR FINANCEIRO utilizável até 10/10/2026

Hoje: 17/09/2026. Janela útil: ~16 dias úteis. Este plano é apenas planejamento: nada será alterado, corrigido, migrado ou publicado sem aprovação.

Base de diagnóstico: auditoria somente leitura de hoje (1.174 lançamentos entre 29/04 e 14/09/2026, 9 centros de custo, 10 contas bancárias, 71 categorias, 55 contatos, 68 lançamentos suspeitos de duplicidade em 58 grupos, 801 sem fornecedor/cliente, 4 sem banco, 73 aportes intercompany, 12 linhas de extrato com data no ano 0036, nenhum saldo manual informado, nenhum período fechado, agosto e setembro sem receitas).

## 1. O que já existe e pode ser aproveitado

| Necessidade de aceite | Já pronto no sistema |
| --- | --- |
| Saldos por conta | Cálculo de saldo (saldo inicial + movimentos), tela de saldo informado por conta com data de referência, indicador manual vs derivado |
| Conciliação | Importador Open Finance em 3 etapas (extrair/checar duplicatas → categorizar → conciliar), conciliação manual em lote (vários itens que somam), upload de extrato, chave anti-duplicidade única |
| Contas a pagar/receber | Lançamento rápido com recorrência e parcelas, edição, grade rápida, status pendente/pago/conciliado |
| DRE | DRE em cascata por centro de custo e consolidada, com separação administrativo/operacional e ajuste intercompany |
| Fluxo de caixa e projeção | Motor de projeção em 4 camadas (realizado, compromissos, estimativa histórica, projeção manual), simulador de DRE com cenários, base sazonal de 2025 |
| Aportes e transferências | Aportes intercompany automáticos, transferência entre contas próprias marcada para não afetar DRE |
| Vendas consolidadas | Lotes de venda com apuração de taxa de cartão e vínculo a movimentos do extrato |
| Visão contábil | Modo planilha (data, descrição, tipo, categoria, valor, saldo acumulado) |

Conclusão: o produto está praticamente completo em funcionalidade. O que falta é sobretudo **qualidade de dados e rotina**, não software novo.

## 2. Lacunas

**Dados**
- Receitas de agosto e setembro ausentes (bloqueia DRE, caixa e projeção).
- Nenhum saldo bancário conferido contra extrato; saldo inicial das contas não informado.
- 58 grupos de possível duplicidade a decidir (manter/excluir).
- ~266 lançamentos (~R$ 87 mil) em categorias genéricas.
- Débitos de boleto/financiamento classificados como aporte (ex.: Intercredis, ~R$ 24 mil) e possíveis aportes duplicados no Sicoob.
- 801 lançamentos sem fornecedor/cliente; 4 sem conta bancária.
- 12 linhas de extrato manual com data inválida (ano 0036).

**Processo**
- Nenhum mês fechado; sem calendário de fechamento nem responsáveis definidos.
- Sem rotina escrita de conciliação (frequência, quem faz, o que fazer com pendência).
- Sem definição de quem aprova exclusão de duplicidade e reclassificação.

**Produto (mínimo)**
- Falta um painel único de "saúde do mês" que mostre, por conta e por centro de custo, o que impede o fechamento (pendências, sem categoria, sem fornecedor, divergência de saldo).
- Falta bloqueio efetivo de datas absurdas na entrada de extrato/lançamento.

## 3. Sequência de trabalho e dependências

```text
Fase 0 (18-19/09)  Decisões do responsável financeiro  ─┐
Fase 1 (19-24/09)  Saldos + higienização de dados       ─┤ depende de Fase 0
Fase 2 (24-30/09)  Receitas ago/set + a pagar/receber   ─┤ depende de Fase 1
Fase 3 (01-04/10)  Fechamento de ago e set + DRE        ─┤ depende de Fase 2
Fase 4 (05-08/10)  Caixa real + projeção 90 dias        ─┤ depende de Fase 3
Fase 5 (08-10/10)  Rotina documentada + treinamento     ─┘ depende de Fase 4
```

**Fase 0 — Decisões (não é trabalho técnico).** Responder as perguntas do item 7. Sem isso, Fase 1 não pode excluir nem reclassificar nada.

**Fase 1 — Confiança do saldo (o alicerce).**
1. Informar o saldo real de cada uma das 10 contas com data de referência única (sugestão: 31/08/2026), a partir do extrato.
2. Corrigir as 12 linhas de extrato com data inválida.
3. Tratar os 58 grupos de duplicidade, um a um, com aprovação registrada.
4. Reclassificar os débitos de boleto/financiamento hoje marcados como aporte e remover aportes duplicados.
5. Fechar a diferença entre saldo informado e saldo calculado, conta por conta.

**Fase 2 — Completar o movimento.**
1. Importar/registrar as receitas de agosto e setembro (extrato de cada conta + lotes de venda consolidada de Restaurante e Turismo).
2. Reclassificar os lançamentos em categoria genérica, priorizando por valor (os ~R$ 87 mil).
3. Preencher fornecedor/cliente nos lançamentos relevantes — priorizar despesas recorrentes e valores altos; não é necessário cobrir todos os 801 até 10/10.
4. Revisar contas a pagar e receber em aberto: vencidas, a vencer nos próximos 90 dias, recorrências ativas.

**Fase 3 — Fechamento.** Conciliar 100% do movimento de agosto e setembro, fechar os dois meses (travamento de período) e validar a DRE por centro de custo e consolidada contra o extrato.

**Fase 4 — Caixa e projeção.** Com saldo ancorado e meses fechados, gerar o caixa real e a projeção de 90 dias (out/nov/dez), revisar a base sazonal e os compromissos já lançados.

**Fase 5 — Rotina.** Documentar a rotina (diária, semanal, mensal), definir responsáveis e o calendário de fechamento, e treinar quem vai operar.

## 4. Mudanças técnicas mínimas indispensáveis vs. adiáveis

**Indispensáveis (pequenas, de suporte à operação)**
1. Painel "Fechamento do mês": por mês e centro de custo, contadores clicáveis de pendências de conciliação, lançamentos sem categoria, sem fornecedor, sem banco, e divergência saldo informado × calculado. É a lista de tarefas do fechamento.
2. Validação de data na entrada de extrato e lançamento (faixa plausível), impedindo repetição do problema de ano inválido.
3. Tela de revisão de duplicidades: agrupa os candidatos e permite marcar "manter" ou "excluir" com registro de quem decidiu.
4. Regra de classificação de aporte mais estrita no importador: descrição de boleto/financiamento/imposto nunca sugere aporte.
5. Exportação da DRE mensal e do caixa em PDF/planilha para conferência do responsável financeiro.

**Adiáveis (pós-10/10)**
- Conexão automática de extrato (Open Finance ao vivo).
- Integração com sistema de reservas e cobrança automática.
- Aprovação de despesas em fluxo, anexo de comprovantes, calendário financeiro visual.
- Fechamento por evento e centro de resultado por evento.
- Relatórios gerenciais avançados e alertas automáticos por e-mail.

## 5. Critérios objetivos de aceite e testes

| # | Critério | Teste |
| --- | --- | --- |
| 1 | Saldo confiável | Para cada uma das 10 contas: diferença entre saldo informado (data de referência) e saldo calculado = R$ 0,00 |
| 2 | Conciliação | Agosto e setembro com 0 pendências de conciliação; rotina escrita e em uso na semana de 06/10 |
| 3 | A pagar/receber | 0 lançamentos vencidos sem decisão (pago, renegociado ou cancelado); recorrências dos próximos 90 dias criadas |
| 4 | DRE | DRE de agosto e setembro por centro de custo e consolidada; soma das receitas e despesas confere com o extrato do período |
| 5 | Caixa e projeção | Caixa real parte do saldo informado; projeção de 90 dias cobre out/nov/dez com compromissos já lançados |
| 6 | Aportes e transferências | 0 boletos/financiamentos/impostos classificados como aporte; transferências internas com efeito zero na DRE |
| 7 | Rotina | Documento aprovado com responsável e prazo por tarefa; agosto e setembro com período fechado |

Testes de regressão a rodar antes de 10/10: fechar e reabrir um mês; lançar e excluir uma recorrência; importar o mesmo extrato duas vezes (a segunda deve ser 100% duplicidade); criar uma transferência interna e confirmar DRE inalterada; criar um aporte e confirmar reflexo nos dois centros de custo.

## 6. Riscos que podem impedir o prazo

1. **Extratos não entregues em tempo.** Sem os extratos de todas as contas até 24/09, Fases 1 e 2 escorregam e o prazo cai. Risco mais provável.
2. **Decisões sobre duplicidade e reclassificação sem responsável.** 58 grupos exigem julgamento; ninguém além do financeiro pode decidir.
3. **Volume de receitas de agosto/setembro maior que o esperado**, especialmente vendas por cartão/PIX que precisam entrar como lote consolidado com taxa.
4. **Retrabalho por lançamento em paralelo:** se a equipe continuar lançando durante a higienização, novas duplicidades aparecem. Recomenda-se congelar lançamentos manuais nos dias de higienização.
5. **Escopo crescendo** com pedidos de relatório novo antes de os dados fecharem. Tudo o que não está no item 4 fica para depois de 10/10.
6. **Categorias genéricas** podem esconder erro de centro de custo, o que muda a DRE depois de fechada.

## 7. Perguntas e decisões que exigem o responsável financeiro

1. Qual a data de corte do saldo inicial: 31/08/2026 ou 31/07/2026?
2. Quem entrega os extratos de cada uma das 10 contas, e até quando?
3. Nos 58 grupos de duplicidade, quem aprova a exclusão — e devemos manter o registro mais antigo ou o mais recente?
4. Os débitos hoje marcados como aporte (Intercredis e similares) são financiamento, empréstimo entre empresas ou despesa? A classificação correta muda a DRE.
5. Vendas de cartão/PIX de agosto e setembro: temos os relatórios de fechamento da adquirente com valor bruto, taxa e líquido?
6. Quais categorias podem substituir as genéricas? Precisamos de uma lista de-para aprovada.
7. Precisamos de fornecedor/cliente em todos os lançamentos ou só acima de um valor mínimo? Qual valor?
8. Quem fecha o mês, em que dia, e quem pode reabrir um mês fechado?
9. Meses anteriores a agosto (abril a julho) entram no escopo até 10/10 ou ficam para a segunda etapa?
10. Aporte entre empresas do grupo: devolvível (mútuo) ou definitivo? Isso define o tratamento contábil.

## Recomendação de início

Começar hoje pela Fase 0 (respostas do item 7) em paralelo com o pedido dos extratos. Assim que os extratos de duas ou três contas chegarem, iniciar a conferência de saldo dessas contas, sem esperar as demais.
