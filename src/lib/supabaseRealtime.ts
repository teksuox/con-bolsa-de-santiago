import { supabase } from './supabase';
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

function rowToHolding(r: any): StockHolding {
  return {
    id: r.id, ticker: r.ticker, name: r.name,
    shares: r.shares, buyPrice: r.buy_price, currentPrice: r.current_price,
    buyDate: r.buy_date, annualTargetYield: r.annual_target_yield,
    manualPrice: r.manual_price ?? false, updatedAt: r.updated_at
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

function rowToRefund(r: any): TaxRefund {
  return {
    id: r.id, year: r.year, amount: r.amount,
    refundDate: r.refund_date, received: r.received, updatedAt: r.updated_at
  };
}

function rowToAlert(r: any): StockAlert {
  return {
    ticker: r.ticker, starredPrice: r.starred_price,
    targetPrice: r.target_price, triggered: r.triggered,
    lastTriggeredAt: r.last_triggered_at ?? undefined, updatedAt: r.updated_at
  };
}

function rowToCustomStock(r: any): MarketStock {
  return {
    ticker: r.ticker, name: r.name, price: r.price,
    changePercent: r.change_percent, previousClose: r.previous_close ?? undefined,
    dividendYield: r.dividend_yield, sector: r.sector, volumeCLP: r.volume_clp
  };
}

export function subscribeToChanges(uid: string, callbacks: RealtimeCallbacks) {
  if (channel) {
    supabase.removeChannel(channel);
  }

  channel = supabase.channel('db-changes');

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
          if (!payload.new && !payload.old) return;
          const record = payload.new || payload.old;

          switch (table) {
            case 'holdings': {
              if (payload.eventType === 'DELETE') {
                const { data } = await supabase.from('holdings').select('*').eq('user_id', uid);
                callbacks.onHoldingsChanged?.((data || []).map(rowToHolding));
              } else {
                const { data } = await supabase.from('holdings').select('*').eq('user_id', uid);
                callbacks.onHoldingsChanged?.((data || []).map(rowToHolding));
              }
              break;
            }
            case 'dividends': {
              const { data } = await supabase.from('dividends').select('*').eq('user_id', uid);
              callbacks.onDividendsChanged?.((data || []).map(rowToDividend));
              break;
            }
            case 'refunds': {
              const { data } = await supabase.from('refunds').select('*').eq('user_id', uid);
              callbacks.onRefundsChanged?.((data || []).map(rowToRefund));
              break;
            }
            case 'alerts': {
              const { data } = await supabase.from('alerts').select('*').eq('user_id', uid);
              callbacks.onAlertsChanged?.((data || []).map(rowToAlert));
              break;
            }
            case 'custom_stocks': {
              const { data } = await supabase.from('custom_stocks').select('*').eq('user_id', uid);
              callbacks.onCustomStocksChanged?.((data || []).map(rowToCustomStock));
              break;
            }
            case 'settings': {
              callbacks.onSettingsChanged?.();
              break;
            }
            case 'investment_plans': {
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
