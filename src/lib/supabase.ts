import { createClient } from '@supabase/supabase-js';

export interface MonthlyPnLEntry {
  date: string;
  portfolioValue: number;
  dailyPnL: number;
  dailyPnLPct: number;
}

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || '';
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || '';

if (!supabaseUrl || !supabaseAnonKey) {
  console.warn(
    '⚠️ Supabase credentials not set. Cloud sync will not work.\n' +
    'Create a .env file with:\n' +
    '  VITE_SUPABASE_URL=https://tu-proyecto.supabase.co\n' +
    '  VITE_SUPABASE_ANON_KEY=tu-anon-key'
  );
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey);
