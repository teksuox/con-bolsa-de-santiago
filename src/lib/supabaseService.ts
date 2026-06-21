import { supabase } from './supabase';
import type { StockHolding, DividendPayment, TaxRefund, StockAlert, MarketStock } from '../types';
import type { MonthlyPnLEntry } from './supabase';

// ── Field conversion helpers ──

function holdingToRow(h: StockHolding, uid: string) {
  return {
    id: h.id, user_id: uid, ticker: h.ticker, name: h.name,
    shares: h.shares, buy_price: h.buyPrice, current_price: h.currentPrice,
    buy_date: h.buyDate, annual_target_yield: h.annualTargetYield,
    manual_price: h.manualPrice ?? false, updated_at: new Date().toISOString()
  };
}
function rowToHolding(r: any): StockHolding {
  return {
    id: r.id, ticker: r.ticker, name: r.name,
    shares: r.shares, buyPrice: r.buy_price, currentPrice: r.current_price,
    buyDate: r.buy_date, annualTargetYield: r.annual_target_yield,
    manualPrice: r.manual_price ?? false, updatedAt: r.updated_at
  };
}

function dividendToRow(d: DividendPayment, uid: string) {
  return {
    id: d.id, user_id: uid, ticker: d.ticker,
    shares_count: d.sharesCount, amount_per_share: d.amountPerShare,
    total_amount: d.totalAmount, payout_date: d.payoutDate,
    cutoff_date: d.cutoffDate ?? null, received: d.received,
    estimated: d.estimated ?? false, updated_at: new Date().toISOString()
  };
}
function rowToDividend(r: any): DividendPayment {
  return {
    id: r.id, ticker: r.ticker,
    sharesCount: r.shares_count, amountPerShare: r.amount_per_share,
    totalAmount: r.total_amount, payoutDate: r.payout_date,
    cutoffDate: r.cutoff_date ?? undefined, received: r.received,
    estimated: r.estimated ?? undefined, updatedAt: r.updated_at
  };
}

function refundToRow(rf: TaxRefund, uid: string) {
  return {
    id: rf.id, user_id: uid, year: rf.year, amount: rf.amount,
    refund_date: rf.refundDate, received: rf.received,
    updated_at: new Date().toISOString()
  };
}
function rowToRefund(r: any): TaxRefund {
  return {
    id: r.id, year: r.year, amount: r.amount,
    refundDate: r.refund_date, received: r.received, updatedAt: r.updated_at
  };
}

function alertToRow(a: StockAlert, uid: string) {
  return {
    user_id: uid, ticker: a.ticker,
    starred_price: a.starredPrice, target_price: a.targetPrice,
    triggered: a.triggered, last_triggered_at: a.lastTriggeredAt ?? null,
    updated_at: new Date().toISOString()
  };
}
function rowToAlert(r: any): StockAlert {
  return {
    ticker: r.ticker, starredPrice: r.starred_price,
    targetPrice: r.target_price, triggered: r.triggered,
    lastTriggeredAt: r.last_triggered_at ?? undefined,
    updatedAt: r.updated_at
  };
}

function customStockToRow(s: MarketStock, uid: string) {
  return {
    user_id: uid, ticker: s.ticker, name: s.name, price: s.price,
    change_percent: s.changePercent, previous_close: s.previousClose ?? null,
    dividend_yield: s.dividendYield, sector: s.sector,
    volume_clp: s.volumeCLP, updated_at: new Date().toISOString()
  };
}
function rowToCustomStock(r: any): MarketStock {
  return {
    ticker: r.ticker, name: r.name, price: r.price,
    changePercent: r.change_percent, previousClose: r.previous_close ?? undefined,
    dividendYield: r.dividend_yield, sector: r.sector,
    volumeCLP: r.volume_clp
  };
}

// ── Helpers ──

function userIdOrThrow(): Promise<string> {
  return supabase.auth.getUser().then(({ data: { user } }) => {
    if (!user) throw new Error('Debes iniciar sesión.');
    return user.id;
  });
}

async function upsertRows(table: string, rows: any[], conflict: string) {
  const { error } = await supabase.from(table).upsert(rows, { onConflict: conflict });
  if (error) console.warn(`supabaseService.upsert(${table}):`, error.message);
}

async function fetchRows<T>(table: string, toTS: (r: any) => T, since?: string): Promise<T[]> {
  const uid = await userIdOrThrow();
  let query = supabase.from(table).select('*').eq('user_id', uid);
  if (since) query = query.gt('updated_at', since);
  const { data, error } = await query;
  if (error) { console.warn(`supabaseService.fetch(${table}):`, error.message); return []; }
  return (data || []).map(toTS);
}

async function deleteRow(table: string, idCol: string, id: string) {
  const uid = await userIdOrThrow();
  const { error } = await supabase.from(table).delete().eq('user_id', uid).eq(idCol, id);
  if (error) console.warn(`supabaseService.delete(${table}):`, error.message);
}

// ── Public API ──

export const supabaseService = {
  // Holdings
  syncHolding(h: StockHolding) {
    return userIdOrThrow().then(uid => upsertRows('holdings', [holdingToRow(h, uid)], 'id'));
  },
  pullHoldings(since?: string) {
    return fetchRows('holdings', rowToHolding, since);
  },
  deleteHolding(id: string) {
    return deleteRow('holdings', 'id', id);
  },

  // Dividends
  syncDividend(d: DividendPayment) {
    return userIdOrThrow().then(uid => upsertRows('dividends', [dividendToRow(d, uid)], 'id'));
  },
  pullDividends(since?: string) {
    return fetchRows('dividends', rowToDividend, since);
  },
  deleteDividend(id: string) {
    return deleteRow('dividends', 'id', id);
  },

  // Tax Refunds
  syncRefund(rf: TaxRefund) {
    return userIdOrThrow().then(uid => upsertRows('refunds', [refundToRow(rf, uid)], 'id'));
  },
  pullRefunds(since?: string) {
    return fetchRows('refunds', rowToRefund, since);
  },
  deleteRefund(id: string) {
    return deleteRow('refunds', 'id', id);
  },

  // Alerts
  syncAlert(a: StockAlert) {
    return userIdOrThrow().then(uid => upsertRows('alerts', [alertToRow(a, uid)], 'user_id,ticker'));
  },
  pullAlerts(since?: string) {
    return fetchRows('alerts', rowToAlert, since);
  },
  deleteAlert(ticker: string) {
    return deleteRow('alerts', 'ticker', ticker);
  },

  // Custom Stocks
  syncCustomStock(s: MarketStock) {
    return userIdOrThrow().then(uid => upsertRows('custom_stocks', [customStockToRow(s, uid)], 'user_id,ticker'));
  },
  pullCustomStocks(since?: string) {
    return fetchRows('custom_stocks', rowToCustomStock, since);
  },
  deleteCustomStock(ticker: string) {
    return deleteRow('custom_stocks', 'ticker', ticker);
  },

  // Settings
  async syncSettings(opts: { annualPerformancePercent: number }) {
    const uid = await userIdOrThrow();
    return upsertRows('settings', [{ user_id: uid, annual_performance_percent: opts.annualPerformancePercent, updated_at: new Date().toISOString() }], 'user_id');
  },
  async pullSettings(): Promise<{ annualPerformancePercent: number } | null> {
    const uid = await userIdOrThrow();
    const { data, error } = await supabase.from('settings').select('*').eq('user_id', uid).maybeSingle();
    if (error || !data) return null;
    return { annualPerformancePercent: data.annual_performance_percent ?? 8.5 };
  },

  // Investment Plan
  async syncInvestmentPlan(plan: { budget: number; allocations: any[] }) {
    const uid = await userIdOrThrow();
    return upsertRows('investment_plans', [{
      user_id: uid,
      budget: plan.budget,
      allocations: plan.allocations,
      updated_at: new Date().toISOString()
    }], 'user_id');
  },
  async pullInvestmentPlan(): Promise<{ budget: number; allocations: any[] } | null> {
    const uid = await userIdOrThrow();
    const { data, error } = await supabase.from('investment_plans').select('budget, allocations').eq('user_id', uid).maybeSingle();
    if (error || !data) return null;
    return { budget: data.budget, allocations: data.allocations ?? [] };
  },

  // Pull all entities newer than a given timestamp
  async pullAll(since?: string) {
    const [holdings, dividends, refunds, alerts, customStocks, settings, investmentPlan] = await Promise.all([
      this.pullHoldings(since),
      this.pullDividends(since),
      this.pullRefunds(since),
      this.pullAlerts(since),
      this.pullCustomStocks(since),
      this.pullSettings(),
      this.pullInvestmentPlan()
    ]);
    return { holdings, dividends, refunds, alerts, customStocks, settings, investmentPlan };
  },

  // Monthly PnL
  async pullMonthlyPnL(months: string[]): Promise<Record<string, MonthlyPnLEntry[]>> {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user || months.length === 0) return {};
    const { data, error } = await supabase
      .from('monthly_pnl')
      .select('month, data')
      .eq('user_id', user.id)
      .in('month', months);
    if (error) { console.warn('Error fetching monthly P&L:', error.message); return {}; }
    const result: Record<string, MonthlyPnLEntry[]> = {};
    for (const row of data || []) result[row.month] = row.data as MonthlyPnLEntry[];
    return result;
  },

  async saveMonthlyPnL(month: string, entries: MonthlyPnLEntry[]): Promise<void> {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user || entries.length === 0) return;
    const { error } = await supabase.from('monthly_pnl').upsert(
      { user_id: user.id, month, data: entries, updated_at: new Date().toISOString() },
      { onConflict: 'user_id,month' }
    );
    if (error) console.warn('Error saving monthly P&L:', error.message);
  },

  // Full backup / restore
  async exportBackup() {
    const all = await this.pullAll();
    const { data: { user } } = await supabase.auth.getUser();
    // Also fetch PnL months
    const { data: pnlRows } = await supabase.from('monthly_pnl').select('month, data').eq('user_id', user!.id);
    const pnls: Record<string, MonthlyPnLEntry[]> = {};
    for (const r of pnlRows || []) pnls[r.month] = r.data as MonthlyPnLEntry[];
    return { ...all, monthlyPnl: pnls };
  },

  async importBackup(data: any) {
    const uid = await userIdOrThrow();
    // Holdings
    for (const h of data.holdings || []) await this.syncHolding(h);
    for (const d of data.dividends || []) await this.syncDividend(d);
    for (const r of data.refunds || []) await this.syncRefund(r);
    for (const a of data.alerts || []) await this.syncAlert(a);
    for (const s of data.customStocks || []) await this.syncCustomStock(s);
    if (data.settings?.annualPerformancePercent != null) await this.syncSettings(data.settings);
    if (data.investmentPlan) await this.syncInvestmentPlan(data.investmentPlan);
    // Monthly PnL
    if (data.monthlyPnl) {
      for (const [month, entries] of Object.entries(data.monthlyPnl)) {
        await this.saveMonthlyPnL(month, entries as MonthlyPnLEntry[]);
      }
    }
  },

  async clearAllData() {
    const uid = await userIdOrThrow();
    const tables = ['holdings', 'dividends', 'refunds', 'alerts', 'custom_stocks', 'settings', 'investment_plans', 'monthly_pnl'];
    for (const t of tables) {
      const { error } = await supabase.from(t).delete().eq('user_id', uid);
      if (error) console.warn(`Error clearing ${t}:`, error.message);
    }
  }
};
