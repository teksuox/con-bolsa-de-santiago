-- Habilitar Realtime en todas las tablas de portafolio
-- Ejecutar en Supabase SQL Editor → Database → Replication

-- Primero asegurar que la publicación existe
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    CREATE PUBLICATION supabase_realtime;
  END IF;
END
$$;

-- Agregar cada tabla a la publicación de Realtime
ALTER PUBLICATION supabase_realtime ADD TABLE ONLY public.holdings;
ALTER PUBLICATION supabase_realtime ADD TABLE ONLY public.dividends;
ALTER PUBLICATION supabase_realtime ADD TABLE ONLY public.refunds;
ALTER PUBLICATION supabase_realtime ADD TABLE ONLY public.alerts;
ALTER PUBLICATION supabase_realtime ADD TABLE ONLY public.custom_stocks;
ALTER PUBLICATION supabase_realtime ADD TABLE ONLY public.settings;
ALTER PUBLICATION supabase_realtime ADD TABLE ONLY public.investment_plans;

-- Alternativa: si prefieres desde la UI de Supabase:
-- 1. Ve a Database → Replication
-- 2. En "Source" selecciona las tablas: holdings, dividends, refunds, alerts, custom_stocks, settings, investment_plans
-- 3. Click en "Enable Realtime"
