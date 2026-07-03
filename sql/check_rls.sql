-- Políticas RLS por tabla
SELECT tablename, policyname, cmd AS command
FROM pg_policies
WHERE schemaname = 'public'
ORDER BY tablename, policyname;

-- RLS habilitado?
SELECT relname, relrowsecurity AS rls_on
FROM pg_class
WHERE relnamespace = 'public'::regnamespace
  AND relkind = 'r'
  AND relname IN ('holdings','dividends','refunds','alerts','custom_stocks','settings','monthly_pnl')
ORDER BY relname;
