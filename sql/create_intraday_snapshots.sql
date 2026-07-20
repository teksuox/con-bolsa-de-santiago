-- Tabla para snapshots intradiarios del portafolio
-- Almacena arrays JSONB por día, mismo patrón que monthly_pnl

CREATE TABLE IF NOT EXISTS public.intraday_snapshots (
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  date TEXT NOT NULL,
  data JSONB NOT NULL DEFAULT '[]',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, date)
);

ALTER TABLE public.intraday_snapshots ENABLE ROW LEVEL SECURITY;

CREATE POLICY intraday_snapshots_select_own ON public.intraday_snapshots
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY intraday_snapshots_insert_own ON public.intraday_snapshots
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY intraday_snapshots_update_own ON public.intraday_snapshots
  FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY intraday_snapshots_delete_own ON public.intraday_snapshots
  FOR DELETE USING (auth.uid() = user_id);

-- Realtime opcional (por ahora no es necesario porque el worker escribe, no necesita broadcast)
