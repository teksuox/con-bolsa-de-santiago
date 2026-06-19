import { supabase } from './supabase';
import { portafolioDB } from '../db';
import type { StockHolding, DividendPayment, TaxRefund, StockAlert, MarketStock } from '../types';

type RealtimeCallbacks = {
  onHoldingsChanged?: (holdings: StockHolding[]) => void;
  onDividendsChanged?: (dividends: DividendPayment[]) => void;
  onRefundsChanged?: (refunds: TaxRefund[]) => void;
  onAlertsChanged?: (alerts: StockAlert[]) => void;
  onCustomStocksChanged?: (stocks: MarketStock[]) => void;
  onSettingsChanged?: () => void;
  onInvestmentPlanChanged?: () => void;
};

let channel: ReturnType<typeof supabase.channel> | null = null;

export function subscribeToChanges(uid: string, callbacks: RealtimeCallbacks) {
  // Clean up previous subscription
  if (channel) {
    supabase.removeChannel(channel);
  }

  channel = supabase.channel('db-changes');

  // Subscribe to all relevant tables
  const tables = ['holdings', 'dividends', 'refunds', 'alerts', 'custom_stocks', 'settings', 'investment_plans'] as const;

  for (const table of tables) {
    channel = channel.on(
      'postgres_changes' as any,
      {
        event: '*',
        schema: 'public',
        table,
        filter: `user_id=eq.${uid}`
      },
      async (payload: any) => {
        try {
          // Only process if we have the right data
          if (!payload.new && !payload.old) return;

          const record = payload.new || payload.old;

          switch (table) {
            case 'holdings': {
              const local = await portafolioDB.getHoldings();
              const existing = local.find(h => h.id === record.id);
              if (payload.eventType === 'DELETE') {
                if (existing) {
                  await portafolioDB.deleteHolding(record.id);
                  callbacks.onHoldingsChanged?.(local.filter(h => h.id !== record.id));
                }
              } else if (!existing || (existing.updatedAt || '') < (record.updated_at || '')) {
                const holding: StockHolding = {
                  id: record.id, ticker: record.ticker, name: record.name,
                  shares: record.shares, buyPrice: record.buy_price,
                  currentPrice: record.current_price, buyDate: record.buy_date,
                  annualTargetYield: record.annual_target_yield,
                  manualPrice: record.manual_price ?? false,
                  updatedAt: record.updated_at
                };
                await portafolioDB.saveHolding(holding);
                const updated = local.map(h => h.id === holding.id ? holding : h);
                if (!existing) updated.push(holding);
                callbacks.onHoldingsChanged?.(updated);
              }
              break;
            }
            case 'dividends': {
              const local = await portafolioDB.getDividends();
              const existing = local.find(d => d.id === record.id);
              if (payload.eventType === 'DELETE') {
                if (existing) {
                  await portafolioDB.deleteDividend(record.id);
                  callbacks.onDividendsChanged?.(local.filter(d => d.id !== record.id));
                }
              } else if (!existing || (existing.updatedAt || '') < (record.updated_at || '')) {
                const div: DividendPayment = {
                  id: record.id, ticker: record.ticker,
                  sharesCount: record.shares_count, amountPerShare: record.amount_per_share,
                  totalAmount: record.total_amount, payoutDate: record.payout_date,
                  cutoffDate: record.cutoff_date ?? undefined,
                  received: record.received, estimated: record.estimated ?? undefined,
                  updatedAt: record.updated_at
                };
                await portafolioDB.saveDividend(div);
                const updated = local.map(d => d.id === div.id ? div : d);
                if (!existing) updated.push(div);
                callbacks.onDividendsChanged?.(updated);
              }
              break;
            }
            case 'refunds': {
              const local = await portafolioDB.getRefunds();
              const existing = local.find(r => r.id === record.id);
              if (payload.eventType === 'DELETE') {
                if (existing) {
                  await portafolioDB.deleteRefund(record.id);
                  callbacks.onRefundsChanged?.(local.filter(r => r.id !== record.id));
                }
              } else if (!existing || (existing.updatedAt || '') < (record.updated_at || '')) {
                const rf: TaxRefund = {
                  id: record.id, year: record.year, amount: record.amount,
                  refundDate: record.refund_date, received: record.received,
                  updatedAt: record.updated_at
                };
                await portafolioDB.saveRefund(rf);
                const updated = local.map(r => r.id === rf.id ? rf : r);
                if (!existing) updated.push(rf);
                callbacks.onRefundsChanged?.(updated);
              }
              break;
            }
            case 'alerts': {
              if (payload.eventType !== 'DELETE') {
                const alert: StockAlert = {
                  ticker: record.ticker, starredPrice: record.starred_price,
                  targetPrice: record.target_price, triggered: record.triggered,
                  lastTriggeredAt: record.last_triggered_at ?? undefined,
                  updatedAt: record.updated_at
                };
                await portafolioDB.saveAlert(alert);
              } else {
                await portafolioDB.deleteAlert(record.ticker);
              }
              const alerts = await portafolioDB.getAlerts();
              callbacks.onAlertsChanged?.(alerts);
              break;
            }
            case 'custom_stocks': {
              if (payload.eventType !== 'DELETE') {
                const stock: MarketStock = {
                  ticker: record.ticker, name: record.name, price: record.price,
                  changePercent: record.change_percent,
                  previousClose: record.previous_close ?? undefined,
                  dividendYield: record.dividend_yield, sector: record.sector,
                  volumeCLP: record.volume_clp
                };
                await portafolioDB.saveCustomStock(stock);
              } else {
                await portafolioDB.deleteCustomStock(record.ticker);
              }
              const stocks = await portafolioDB.getCustomStocks();
              callbacks.onCustomStocksChanged?.(stocks);
              break;
            }
            case 'settings': {
              await portafolioDB.saveAnnualYield(record.annual_performance_percent ?? 8.5);
              callbacks.onSettingsChanged?.();
              break;
            }
            case 'investment_plans': {
              if (payload.eventType !== 'DELETE') {
                await portafolioDB.saveInvestmentPlan({ budget: record.budget, allocations: record.allocations ?? [] });
              }
              callbacks.onInvestmentPlanChanged?.();
              break;
            }
          }
        } catch (e) {
          console.warn(`[Realtime] Error processing ${table} change:`, e);
        }
      }
    );
  }

  channel.subscribe((status: string) => {
    console.log(`[Realtime] Channel status: ${status}`);
  });

  return () => {
    if (channel) {
      supabase.removeChannel(channel);
      channel = null;
    }
  };
}

export function unsubscribeFromChanges() {
  if (channel) {
    supabase.removeChannel(channel);
    channel = null;
  }
}
