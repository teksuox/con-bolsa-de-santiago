-- ============================================================
-- Crear todas las tablas necesarias para Portafolio Bolsa
-- Ejecutar en: Supabase Dashboard → SQL Editor
-- ============================================================

-- 1. holdings
CREATE TABLE IF NOT EXISTS public.holdings (
  id TEXT PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  ticker TEXT NOT NULL,
  name TEXT NOT NULL,
  shares NUMERIC NOT NULL DEFAULT 0,
  buy_price NUMERIC NOT NULL DEFAULT 0,
  current_price NUMERIC NOT NULL DEFAULT 0,
  buy_date TEXT NOT NULL,
  annual_target_yield NUMERIC NOT NULL DEFAULT 0,
  manual_price BOOLEAN NOT NULL DEFAULT FALSE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE public.holdings ENABLE ROW LEVEL SECURITY;
CREATE POLICY holdings_select_own ON public.holdings FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY holdings_insert_own ON public.holdings FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY holdings_update_own ON public.holdings FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY holdings_delete_own ON public.holdings FOR DELETE USING (auth.uid() = user_id);

-- 2. dividends
CREATE TABLE IF NOT EXISTS public.dividends (
  id TEXT PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  ticker TEXT NOT NULL,
  shares_count NUMERIC NOT NULL DEFAULT 0,
  amount_per_share NUMERIC NOT NULL DEFAULT 0,
  total_amount NUMERIC NOT NULL DEFAULT 0,
  payout_date TEXT NOT NULL,
  cutoff_date TEXT,
  received BOOLEAN NOT NULL DEFAULT FALSE,
  estimated BOOLEAN NOT NULL DEFAULT FALSE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE public.dividends ENABLE ROW LEVEL SECURITY;
CREATE POLICY dividends_select_own ON public.dividends FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY dividends_insert_own ON public.dividends FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY dividends_update_own ON public.dividends FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY dividends_delete_own ON public.dividends FOR DELETE USING (auth.uid() = user_id);

-- 3. refunds
CREATE TABLE IF NOT EXISTS public.refunds (
  id TEXT PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  year NUMERIC NOT NULL,
  amount NUMERIC NOT NULL DEFAULT 0,
  refund_date TEXT NOT NULL,
  received BOOLEAN NOT NULL DEFAULT FALSE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE public.refunds ENABLE ROW LEVEL SECURITY;
CREATE POLICY refunds_select_own ON public.refunds FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY refunds_insert_own ON public.refunds FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY refunds_update_own ON public.refunds FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY refunds_delete_own ON public.refunds FOR DELETE USING (auth.uid() = user_id);

-- 4. alerts
CREATE TABLE IF NOT EXISTS public.alerts (
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  ticker TEXT NOT NULL,
  starred_price NUMERIC NOT NULL DEFAULT 0,
  target_price NUMERIC NOT NULL DEFAULT 0,
  triggered BOOLEAN NOT NULL DEFAULT FALSE,
  last_triggered_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, ticker)
);
ALTER TABLE public.alerts ENABLE ROW LEVEL SECURITY;
CREATE POLICY alerts_select_own ON public.alerts FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY alerts_insert_own ON public.alerts FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY alerts_update_own ON public.alerts FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY alerts_delete_own ON public.alerts FOR DELETE USING (auth.uid() = user_id);

-- 5. custom_stocks
CREATE TABLE IF NOT EXISTS public.custom_stocks (
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  ticker TEXT NOT NULL,
  name TEXT NOT NULL,
  price NUMERIC NOT NULL DEFAULT 0,
  change_percent NUMERIC NOT NULL DEFAULT 0,
  previous_close NUMERIC,
  dividend_yield NUMERIC NOT NULL DEFAULT 0,
  sector TEXT NOT NULL DEFAULT '',
  volume_clp NUMERIC NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, ticker)
);
ALTER TABLE public.custom_stocks ENABLE ROW LEVEL SECURITY;
CREATE POLICY custom_stocks_select_own ON public.custom_stocks FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY custom_stocks_insert_own ON public.custom_stocks FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY custom_stocks_update_own ON public.custom_stocks FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY custom_stocks_delete_own ON public.custom_stocks FOR DELETE USING (auth.uid() = user_id);

-- 6. settings
CREATE TABLE IF NOT EXISTS public.settings (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  annual_performance_percent NUMERIC NOT NULL DEFAULT 8.5,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE public.settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY settings_select_own ON public.settings FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY settings_insert_own ON public.settings FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY settings_update_own ON public.settings FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY settings_delete_own ON public.settings FOR DELETE USING (auth.uid() = user_id);

-- 7. monthly_pnl
CREATE TABLE IF NOT EXISTS public.monthly_pnl (
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  month TEXT NOT NULL,
  data JSONB NOT NULL DEFAULT '[]',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, month)
);
ALTER TABLE public.monthly_pnl ENABLE ROW LEVEL SECURITY;
CREATE POLICY monthly_pnl_select_own ON public.monthly_pnl FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY monthly_pnl_insert_own ON public.monthly_pnl FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY monthly_pnl_update_own ON public.monthly_pnl FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY monthly_pnl_delete_own ON public.monthly_pnl FOR DELETE USING (auth.uid() = user_id);

-- 8. market_data (caché del servidor, no necesita RLS porque se accede desde service_role)
CREATE TABLE IF NOT EXISTS public.market_data (
  key TEXT PRIMARY KEY,
  data JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- Habilitar Realtime para todas las tablas (solo si no están ya)
-- ============================================================
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    CREATE PUBLICATION supabase_realtime;
  END IF;
END $$;

DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND tablename = 'holdings') THEN ALTER PUBLICATION supabase_realtime ADD TABLE public.holdings; END IF; END $$;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND tablename = 'dividends') THEN ALTER PUBLICATION supabase_realtime ADD TABLE public.dividends; END IF; END $$;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND tablename = 'refunds') THEN ALTER PUBLICATION supabase_realtime ADD TABLE public.refunds; END IF; END $$;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND tablename = 'alerts') THEN ALTER PUBLICATION supabase_realtime ADD TABLE public.alerts; END IF; END $$;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND tablename = 'custom_stocks') THEN ALTER PUBLICATION supabase_realtime ADD TABLE public.custom_stocks; END IF; END $$;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND tablename = 'settings') THEN ALTER PUBLICATION supabase_realtime ADD TABLE public.settings; END IF; END $$;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND tablename = 'investment_plans') THEN ALTER PUBLICATION supabase_realtime ADD TABLE public.investment_plans; END IF; END $$;
