-- ============================================================
-- Agregar PRIMARY KEY y constraints UNIQUE donde falten
-- ============================================================

-- holdings: id debe ser PK
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_schema = 'public' AND table_name = 'holdings' AND constraint_type = 'PRIMARY KEY'
  ) THEN
    ALTER TABLE public.holdings ADD PRIMARY KEY (id);
  END IF;
END $$;

-- dividends: id debe ser PK
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_schema = 'public' AND table_name = 'dividends' AND constraint_type = 'PRIMARY KEY'
  ) THEN
    ALTER TABLE public.dividends ADD PRIMARY KEY (id);
  END IF;
END $$;

-- refunds: id debe ser PK
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_schema = 'public' AND table_name = 'refunds' AND constraint_type = 'PRIMARY KEY'
  ) THEN
    ALTER TABLE public.refunds ADD PRIMARY KEY (id);
  END IF;
END $$;

-- Verificar todas las PK
SELECT table_name, constraint_name, constraint_type
FROM information_schema.table_constraints
WHERE table_schema = 'public'
  AND table_name IN ('holdings','dividends','refunds','alerts','custom_stocks','settings','monthly_pnl')
ORDER BY table_name;
