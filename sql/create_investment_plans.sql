-- Crear tabla investment_plans
CREATE TABLE IF NOT EXISTS public.investment_plans (
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  budget NUMERIC NOT NULL DEFAULT 1000000,
  allocations JSONB NOT NULL DEFAULT '[]',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id)
);

-- RLS
ALTER TABLE public.investment_plans ENABLE ROW LEVEL SECURITY;

-- Políticas: cada usuario solo puede ver/modificar su propio plan
CREATE POLICY "investment_plans_select_own" ON public.investment_plans
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "investment_plans_insert_own" ON public.investment_plans
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "investment_plans_update_own" ON public.investment_plans
  FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "investment_plans_delete_own" ON public.investment_plans
  FOR DELETE USING (auth.uid() = user_id);
