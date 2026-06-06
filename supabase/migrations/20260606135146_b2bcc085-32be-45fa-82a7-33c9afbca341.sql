
-- ENUMS
CREATE TYPE public.app_role AS ENUM ('master', 'user');
CREATE TYPE public.transaction_type AS ENUM ('payable', 'receivable');
CREATE TYPE public.transaction_status AS ENUM ('pending', 'paid', 'reconciled');

-- USER ROLES
CREATE TABLE public.user_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role public.app_role NOT NULL DEFAULT 'user',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id, role)
);
GRANT SELECT ON public.user_roles TO authenticated;
GRANT ALL ON public.user_roles TO service_role;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "users read own roles" ON public.user_roles FOR SELECT TO authenticated USING (auth.uid() = user_id);

-- has_role function
CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role public.app_role)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role)
$$;

CREATE OR REPLACE FUNCTION public.is_master()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.has_role(auth.uid(), 'master')
$$;

-- Auto-promote master on signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.email = 'drs.cachoeira@gmail.com' THEN
    INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'master')
    ON CONFLICT (user_id, role) DO NOTHING;
  ELSE
    INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'user')
    ON CONFLICT (user_id, role) DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_created
AFTER INSERT ON auth.users
FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- COST CENTERS (blocos)
CREATE TABLE public.cost_centers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code INT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  master_only BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.cost_centers TO authenticated;
GRANT ALL ON public.cost_centers TO service_role;
ALTER TABLE public.cost_centers ENABLE ROW LEVEL SECURITY;
CREATE POLICY "view cost centers" ON public.cost_centers FOR SELECT TO authenticated
  USING (master_only = false OR public.is_master());
CREATE POLICY "master writes cost centers" ON public.cost_centers FOR ALL TO authenticated
  USING (public.is_master()) WITH CHECK (public.is_master());

-- ACCOUNTS (subcategorias)
CREATE TABLE public.accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cost_center_id UUID NOT NULL REFERENCES public.cost_centers(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'expense', -- 'expense' | 'revenue'
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.accounts TO authenticated;
GRANT ALL ON public.accounts TO service_role;
ALTER TABLE public.accounts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "view accounts" ON public.accounts FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.cost_centers c WHERE c.id = accounts.cost_center_id AND (c.master_only = false OR public.is_master())));
CREATE POLICY "master writes accounts" ON public.accounts FOR ALL TO authenticated
  USING (public.is_master()) WITH CHECK (public.is_master());

-- BANK ACCOUNTS
CREATE TABLE public.bank_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  bank TEXT,
  initial_balance NUMERIC(14,2) NOT NULL DEFAULT 0,
  master_only BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.bank_accounts TO authenticated;
GRANT ALL ON public.bank_accounts TO service_role;
ALTER TABLE public.bank_accounts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "view bank accounts" ON public.bank_accounts FOR SELECT TO authenticated
  USING (master_only = false OR public.is_master());
CREATE POLICY "master writes bank accounts" ON public.bank_accounts FOR ALL TO authenticated
  USING (public.is_master()) WITH CHECK (public.is_master());

-- TRANSACTIONS
CREATE TABLE public.transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cost_center_id UUID NOT NULL REFERENCES public.cost_centers(id),
  account_id UUID NOT NULL REFERENCES public.accounts(id),
  bank_account_id UUID REFERENCES public.bank_accounts(id),
  type public.transaction_type NOT NULL,
  amount NUMERIC(14,2) NOT NULL,
  description TEXT,
  document_datetime TIMESTAMPTZ,
  due_date DATE NOT NULL,
  paid_at TIMESTAMPTZ,
  status public.transaction_status NOT NULL DEFAULT 'pending',
  is_batch BOOLEAN NOT NULL DEFAULT false,
  parent_transaction_id UUID REFERENCES public.transactions(id) ON DELETE SET NULL,
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_tx_due_date ON public.transactions(due_date);
CREATE INDEX idx_tx_cost_center ON public.transactions(cost_center_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.transactions TO authenticated;
GRANT ALL ON public.transactions TO service_role;
ALTER TABLE public.transactions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "view transactions" ON public.transactions FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.cost_centers c WHERE c.id = transactions.cost_center_id AND (c.master_only = false OR public.is_master())));
CREATE POLICY "insert transactions" ON public.transactions FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM public.cost_centers c WHERE c.id = transactions.cost_center_id AND (c.master_only = false OR public.is_master())));
CREATE POLICY "update transactions" ON public.transactions FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.cost_centers c WHERE c.id = transactions.cost_center_id AND (c.master_only = false OR public.is_master())))
  WITH CHECK (EXISTS (SELECT 1 FROM public.cost_centers c WHERE c.id = transactions.cost_center_id AND (c.master_only = false OR public.is_master())));
CREATE POLICY "delete transactions" ON public.transactions FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.cost_centers c WHERE c.id = transactions.cost_center_id AND (c.master_only = false OR public.is_master())));

CREATE OR REPLACE FUNCTION public.touch_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;
CREATE TRIGGER tx_touch BEFORE UPDATE ON public.transactions FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- BANK STATEMENT LINES
CREATE TABLE public.bank_statement_lines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bank_account_id UUID NOT NULL REFERENCES public.bank_accounts(id) ON DELETE CASCADE,
  statement_date DATE NOT NULL,
  amount NUMERIC(14,2) NOT NULL,
  description TEXT,
  matched_transaction_id UUID REFERENCES public.transactions(id) ON DELETE SET NULL,
  reconciled BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_bsl_date ON public.bank_statement_lines(statement_date);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.bank_statement_lines TO authenticated;
GRANT ALL ON public.bank_statement_lines TO service_role;
ALTER TABLE public.bank_statement_lines ENABLE ROW LEVEL SECURITY;
CREATE POLICY "view bsl" ON public.bank_statement_lines FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.bank_accounts b WHERE b.id = bank_statement_lines.bank_account_id AND (b.master_only = false OR public.is_master())));
CREATE POLICY "write bsl" ON public.bank_statement_lines FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.bank_accounts b WHERE b.id = bank_statement_lines.bank_account_id AND (b.master_only = false OR public.is_master())))
  WITH CHECK (EXISTS (SELECT 1 FROM public.bank_accounts b WHERE b.id = bank_statement_lines.bank_account_id AND (b.master_only = false OR public.is_master())));

-- SEED COST CENTERS
INSERT INTO public.cost_centers (code, name, master_only) VALUES
  (1, 'CACHOEIRA DO GIRASSOL', false),
  (2, 'RESTAURANTE', false),
  (3, 'VINHEDO GIRASSOL', false),
  (4, 'FAZENDA GIRASSOL', false),
  (5, 'IMPOSTOS', false),
  (6, 'GHR EMPREENDIMENTOS', true);

-- SEED ACCOUNTS
DO $$
DECLARE
  cc1 UUID; cc2 UUID; cc3 UUID; cc4 UUID; cc5 UUID; cc6 UUID;
BEGIN
  SELECT id INTO cc1 FROM public.cost_centers WHERE code = 1;
  SELECT id INTO cc2 FROM public.cost_centers WHERE code = 2;
  SELECT id INTO cc3 FROM public.cost_centers WHERE code = 3;
  SELECT id INTO cc4 FROM public.cost_centers WHERE code = 4;
  SELECT id INTO cc5 FROM public.cost_centers WHERE code = 5;
  SELECT id INTO cc6 FROM public.cost_centers WHERE code = 6;

  INSERT INTO public.accounts (cost_center_id, name, kind) VALUES
    (cc1, 'Aportes para Vinhedo', 'expense'),
    (cc1, 'Equipamentos e Ferramentas', 'expense'),
    (cc1, 'Equipe Fixa', 'expense'),
    (cc1, 'Equipe Terceirizada', 'expense'),
    (cc1, 'Faturamento Camping', 'revenue'),
    (cc1, 'Faturamento Day Use', 'revenue'),
    (cc1, 'Faturamento Outros', 'revenue'),
    (cc1, 'Faturamento Tirolesa', 'revenue'),
    (cc1, 'Investimentos', 'expense'),
    (cc1, 'Logística', 'expense'),
    (cc1, 'Manutenção e Reparos', 'expense'),
    (cc1, 'Marketing', 'expense'),
    (cc1, 'Materiais de Consumo', 'expense'),
    (cc1, 'Outros Custos', 'expense'),
    (cc2, 'Compras A&B', 'expense'),
    (cc2, 'Compras Outros', 'expense'),
    (cc2, 'Equipe Fixa', 'expense'),
    (cc2, 'Equipe Terceirizada', 'expense'),
    (cc2, 'Faturamento Eventos', 'revenue'),
    (cc2, 'Faturamento Vendas', 'revenue'),
    (cc2, 'Gás de Cozinha', 'expense'),
    (cc2, 'Investimentos', 'expense'),
    (cc2, 'Logística', 'expense'),
    (cc2, 'Manutenção e Reparos', 'expense'),
    (cc2, 'Marketing', 'expense'),
    (cc2, 'Materiais de Consumo', 'expense'),
    (cc2, 'Outros Custos', 'expense'),
    (cc2, 'Equipamentos e Ferramentas', 'expense'),
    (cc3, 'Aportes para Cachoeira', 'expense'),
    (cc3, 'Conta Compartilhada VG-CG', 'expense'),
    (cc3, 'Custos Enoturismo', 'expense'),
    (cc3, 'Equipamentos e Ferramentas', 'expense'),
    (cc3, 'Equipe Fixa', 'expense'),
    (cc3, 'Equipe Terceirizada', 'expense'),
    (cc3, 'Faturamento Enoturismo', 'revenue'),
    (cc3, 'Faturamento Outros', 'revenue'),
    (cc3, 'Faturamento Vinhos', 'revenue'),
    (cc3, 'Insumos / Plantio', 'expense'),
    (cc3, 'Investimentos', 'expense'),
    (cc3, 'Logística', 'expense'),
    (cc3, 'Manutenção e Reparos', 'expense'),
    (cc3, 'Marketing', 'expense'),
    (cc3, 'Materiais de Consumo', 'expense'),
    (cc3, 'Outros Custos', 'expense'),
    (cc4, 'Empréstimo', 'expense'),
    (cc4, 'Equipe Terceirizada', 'expense'),
    (cc4, 'GEAP (Plano de Saúde / Farm)', 'expense'),
    (cc4, 'Investimentos Externos', 'expense'),
    (cc4, 'Logística (Luz / Internet / Telefone)', 'expense'),
    (cc4, 'Outras Receitas', 'revenue'),
    (cc4, 'Outros Custos', 'expense'),
    (cc4, 'Pró-Labore', 'expense'),
    (cc5, 'FGTS', 'expense'),
    (cc5, 'GPS', 'expense'),
    (cc5, 'Honorários (Contador)', 'expense'),
    (cc5, 'ITR', 'expense'),
    (cc5, 'Outros Impostos', 'expense'),
    (cc5, 'Simples Nacional', 'expense'),
    (cc6, 'Loteamentos Externos', 'expense'),
    (cc6, 'Adiantamentos Dr. Guilherme', 'expense'),
    (cc6, 'Adiantamentos Dr. Diego', 'expense'),
    (cc6, 'Caixa Holding', 'expense');
END $$;

-- SEED 6 BANK ACCOUNTS
INSERT INTO public.bank_accounts (name, bank, initial_balance, master_only) VALUES
  ('Conta Cachoeira', 'Banco do Brasil', 0, false),
  ('Conta Restaurante', 'Banco do Brasil', 0, false),
  ('Conta Vinhedo', 'Sicredi', 0, false),
  ('Conta Fazenda', 'Banco do Brasil', 0, false),
  ('Conta Impostos', 'Caixa', 0, false),
  ('Caixa Holding GHR', 'Itaú', 0, true);
