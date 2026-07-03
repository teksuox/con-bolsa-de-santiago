-- ============================================================
-- Ver tablas creadas en el schema public
-- ============================================================
SELECT
  table_name,
  table_type,
  CASE WHEN has_table_privilege(table_name, 'SELECT') THEN 'SELECT ✓' ELSE 'SELECT ✗' END AS select_priv,
  CASE WHEN has_table_privilege(table_name, 'INSERT') THEN 'INSERT ✓' ELSE 'INSERT ✗' END AS insert_priv,
  CASE WHEN has_table_privilege(table_name, 'UPDATE') THEN 'UPDATE ✓' ELSE 'UPDATE ✗' END AS update_priv,
  CASE WHEN has_table_privilege(table_name, 'DELETE') THEN 'DELETE ✓' ELSE 'DELETE ✗' END AS delete_priv
FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_type = 'BASE TABLE'
ORDER BY table_name;

-- ============================================================
-- Ver columnas de cada tabla
-- ============================================================
SELECT
  table_name,
  column_name,
  data_type,
  is_nullable,
  COALESCE(character_maximum_length::text, 'N/A') AS max_length,
  column_default
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name IN ('holdings', 'dividends', 'refunds', 'alerts', 'custom_stocks', 'settings', 'monthly_pnl', 'investment_plans', 'market_data')
ORDER BY table_name, ordinal_position;

-- ============================================================
-- Ver políticas RLS activas
-- ============================================================
SELECT
  tablename AS table_name,
  policyname AS policy_name,
  permissive,
  roles,
  cmd AS command,
  qual AS using_expression,
  with_check AS check_expression
FROM pg_policies
WHERE schemaname = 'public'
ORDER BY tablename, policyname;

-- ============================================================
-- Ver si RLS está habilitado en cada tabla
-- ============================================================
SELECT
  relname AS table_name,
  relrowsecurity AS rls_enabled,
  relforcerowsecurity AS rls_forced
FROM pg_class
WHERE relnamespace = 'public'::regnamespace
  AND relkind = 'r'
  AND relname IN ('holdings', 'dividends', 'refunds', 'alerts', 'custom_stocks', 'settings', 'monthly_pnl', 'investment_plans', 'market_data')
ORDER BY relname;

-- ============================================================
-- Ver Realtime publication
-- ============================================================
SELECT
  schemaname,
  tablename,
  pubname
FROM pg_publication_tables
WHERE pubname = 'supabase_realtime'
ORDER BY tablename;
