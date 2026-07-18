import React, { useState, useEffect, useMemo, useRef } from 'react';
import { StockHolding } from '../types';
import { formatCLP } from '../utils';
import { MonthlyPnLEntry } from '../lib/supabase';
import { supabaseService } from '../lib/supabaseService';

interface ProfitHistoryProps {
  holdings: StockHolding[];
  todayPnL?: number;
  hasDataFromToday?: boolean;
}

type DateFilter = 'month' | 'year' | 'custom';

interface PnLEntry {
  date: string;
  portfolioValue: number;
  dailyPnL: number;
  dailyPnLPct: number;
}

function getChileDateStr(date?: Date): string {
  const d = date || new Date();
  return d.toLocaleDateString('en-CA', { timeZone: 'America/Santiago' });
}

function getMonday(d: Date): Date {
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  const m = new Date(d);
  m.setDate(diff);
  return m;
}

function getFirstOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

function getFirstOfYear(d: Date): Date {
  return new Date(d.getFullYear(), 0, 1);
}

const PNL_CACHE_VERSION = 3;

export default function ProfitHistory({ holdings, todayPnL, hasDataFromToday }: ProfitHistoryProps) {
  const [filter, setFilter] = useState<DateFilter>('month');
  const [customStart, setCustomStart] = useState('');
  const [customEnd, setCustomEnd] = useState('');
  const [entries, setEntries] = useState<PnLEntry[]>(() => {
    if (typeof window !== 'undefined') {
      const cached = sessionStorage.getItem('profitHistoryCache');
      if (cached) {
        try {
          const parsed = JSON.parse(cached);
          if (parsed.entries && parsed.entries.length > 0 && parsed.version === PNL_CACHE_VERSION) return parsed.entries;
        } catch {}
      }
    }
    return [];
  });
  const [isLoading, setIsLoading] = useState(false);
  const cacheRef = useRef<PnLEntry[]>(entries);

  const holdingsKey = useMemo(() =>
    holdings.map(h => `${h.id}:${h.ticker}:${h.shares}:${h.buyPrice}:${h.buyDate}`).join('|'),
    [holdings]
  );
  const lastHoldingsKeyRef = useRef(holdingsKey);

  const today = getChileDateStr();

  const uniqueTickers = useMemo(() => {
    const seen = new Set<string>();
    const tickers: string[] = [];
    for (const h of holdings) {
      if (!seen.has(h.ticker)) {
        seen.add(h.ticker);
        tickers.push(h.ticker);
      }
    }
    return tickers.sort();
  }, [holdings]);

  function getMonthKey(dateStr: string): string {
    return dateStr.substring(0, 7);
  }

  function getMonthsInRange(start: string, end: string): string[] {
    const months = new Set<string>();
    const d = new Date(start + 'T12:00:00');
    const endD = new Date(end + 'T12:00:00');
    while (d <= endD) {
      months.add(d.toLocaleDateString('en-CA', { timeZone: 'America/Santiago' }).substring(0, 7));
      d.setMonth(d.getMonth() + 1);
    }
    return Array.from(months).sort();
  }

  useEffect(() => {
    if (uniqueTickers.length === 0) {
      setEntries([]);
      setIsLoading(false);
      return;
    }

    let cancelled = false;

    async function load() {
      if (cacheRef.current.length === 0) {
        setIsLoading(true);
      }

      // Skip fetch when custom filter activated but no dates chosen yet
      if (filter === 'custom' && !customStart && !customEnd) {
        if (!cancelled) { setEntries([]); setIsLoading(false); }
        return;
      }

      const now = new Date();
      let start: Date;
      let end = now;

      switch (filter) {
        case 'month':
          start = getFirstOfMonth(now);
          break;
        case 'year':
          start = getFirstOfYear(now);
          break;
        case 'custom':
          start = customStart ? new Date(customStart + 'T12:00:00') : getFirstOfMonth(now);
          end = customEnd ? new Date(customEnd + 'T12:00:00') : now;
          break;
        default:
          start = getFirstOfMonth(now);
      }

      let startStr = start.toLocaleDateString('en-CA', { timeZone: 'America/Santiago' });
      const endStr = end.toLocaleDateString('en-CA', { timeZone: 'America/Santiago' });

      // Clamp start to the earliest investment date (no data needed before that)
      if (holdings.length > 0) {
        const earliestBuy = holdings.reduce((earliest, h) => h.buyDate < earliest ? h.buyDate : earliest, holdings[0].buyDate);
        if (startStr < earliestBuy) {
          startStr = earliestBuy;
          start = new Date(earliestBuy + 'T12:00:00');
        }
      }

      const holdingsChanged = holdingsKey !== lastHoldingsKeyRef.current;
      const versionChanged = typeof window !== 'undefined' && localStorage.getItem('pnlCacheVersion') !== String(PNL_CACHE_VERSION);
      const skipCache = holdingsChanged || versionChanged;
      let cachedEntries: MonthlyPnLEntry[] = [];

      // 1. Try Supabase monthly_pnl first (skip if holdings/version changed or refresh forced)
      if (!skipCache) {
        const months = getMonthsInRange(startStr, endStr);
        const cached = await supabaseService.pullMonthlyPnL(months);

        for (const m of months) {
          const monthData = cached[m];
          if (monthData) {
            cachedEntries = cachedEntries.concat(monthData.filter(e => e.date >= startStr && e.date <= endStr));
          }
        }
        cachedEntries.sort((a, b) => a.date.localeCompare(b.date));

        // Full cache hit: exclude today (comes from live dashboard) and weekends
        const expectedDates: string[] = [];
        const d = new Date(start);
        while (d <= end) {
          const ds = d.toLocaleDateString('en-CA', { timeZone: 'America/Santiago' });
          const dow = d.getDay();
          if (dow !== 0 && dow !== 6) expectedDates.push(ds);
          d.setDate(d.getDate() + 1);
        }
        const historicalDates = expectedDates.filter(dt => dt < today);
        const cachedDates = new Set(cachedEntries.map(e => e.date));
        const coveredRatio = historicalDates.length > 0
          ? historicalDates.filter(dt => cachedDates.has(dt)).length / historicalDates.length
          : 1;

        // Force refresh if the most recent trading day is missing from cache
        const maxHistoricalDate = historicalDates.length > 0 ? historicalDates[historicalDates.length - 1] : '';
        const maxCachedDate = cachedDates.size > 0 ? Array.from(cachedDates).sort().pop()! : '';
        const missingLatestDay = maxHistoricalDate > maxCachedDate;

        if (coveredRatio >= 0.7 && !missingLatestDay) {
          if (!cancelled) {
            cacheRef.current = cachedEntries;
            lastHoldingsKeyRef.current = holdingsKey;
            sessionStorage.setItem('profitHistoryCache', JSON.stringify({ entries: cachedEntries, version: PNL_CACHE_VERSION }));
            localStorage.setItem('pnlCacheVersion', String(PNL_CACHE_VERSION));
            setEntries(cachedEntries);
            setIsLoading(false);
          }
          return;
        }
      }

      // 2. Cache miss (or holdings changed) — fetch from Yahoo and calculate
      // Fetch extra days before start to ensure we have a previous close for initialPortfolioValue
      const padStart = new Date(startStr + 'T12:00:00');
      padStart.setDate(padStart.getDate() - 7);
      const paddedStartStr = padStart.toLocaleDateString('en-CA', { timeZone: 'America/Santiago' });

      let tickerPrices = new Map<string, Map<string, number>>();
      try {
        const res = await fetch(`/api/portfolio-history?tickers=${encodeURIComponent(uniqueTickers.join(','))}&startDate=${paddedStartStr}&endDate=${endStr}`);
        if (res.ok) {
          const data: { ticker: string; history: { date: string; close: number }[] }[] = await res.json();
          for (const item of data) {
            if (item.history.length === 0) continue;
            const dateMap = new Map<string, number>();
            for (const h of item.history) {
              dateMap.set(h.date, h.close);
            }
            tickerPrices.set(item.ticker, dateMap);
          }
        }
      } catch (err) {
        console.warn('Error fetching price history:', err);
      }

      if (cancelled) return;

      // Collect all dates that have prices for ANY ticker in the range
      const allDates = new Set<string>();
      for (const [, dateMap] of tickerPrices) {
        for (const date of dateMap.keys()) {
          if (date >= startStr && date <= endStr) {
            allDates.add(date);
          }
        }
      }
      const sortedDates = Array.from(allDates).sort();

      if (sortedDates.length === 0) {
        setEntries([]);
        setIsLoading(false);
        return;
      }

      // Helper: closest date strictly before `target` in a sorted date array
      function prevDateStr(dates: string[], target: string): string | null {
        for (let i = dates.length - 1; i >= 0; i--) {
          if (dates[i] < target) return dates[i];
        }
        return null;
      }

      // Compute portfolio value at the close before the first date (initial value)
      const firstDate = sortedDates[0];
      let initialPortfolioValue = 0;
      const holdingsAccounted = new Set<string>();
      for (const h of holdings) {
        if (h.buyDate >= firstDate) continue;
        const priceMap = tickerPrices.get(h.ticker);
        if (!priceMap) continue;
        const tickerDates = Array.from(priceMap.keys()).sort();
        const prevDate = prevDateStr(tickerDates, firstDate);
        if (prevDate) {
          const close = priceMap.get(prevDate);
          if (close && close > 0) {
            initialPortfolioValue += h.shares * close;
            holdingsAccounted.add(h.id);
          }
        }
      }

      // Build a portfolio snapshot per date (skip empty dates)
      let pnlEntries: PnLEntry[] = [];
      let prevValue = initialPortfolioValue;

      // Track last known price per ticker to fill gaps
      const lastKnownPrice = new Map<string, number>();

      for (const date of sortedDates) {
        let portfolioValue = 0;
        let hasAnyPrice = false;
        for (const h of holdings) {
          if (h.buyDate > date) continue;
          const priceMap = tickerPrices.get(h.ticker);
          if (!priceMap) continue;
          const close = priceMap.get(date);
          let priceToUse: number | null = null;
          if (close != null && close > 0) {
            priceToUse = close;
            lastKnownPrice.set(h.ticker, close);
            hasAnyPrice = true;
          } else {
            // Use last known price if available
            const lastPrice = lastKnownPrice.get(h.ticker);
            if (lastPrice != null) {
              priceToUse = lastPrice;
              hasAnyPrice = true;
            }
          }
          if (priceToUse != null) {
            portfolioValue += h.shares * priceToUse;
          }
        }

        if (!hasAnyPrice || portfolioValue === 0) continue;

        let newBasis = 0;
        for (const h of holdings) {
          if (holdingsAccounted.has(h.id)) continue;
          if (h.buyDate > date) continue;
          newBasis += h.shares * h.buyPrice;
          holdingsAccounted.add(h.id);
        }

        const adjustedPrev = prevValue + newBasis;
        const dailyPnL = portfolioValue - adjustedPrev;
        const dailyPnLPct = adjustedPrev > 0 ? (dailyPnL / adjustedPrev) * 100 : 0;

        pnlEntries.push({
          date,
          portfolioValue: Math.round(portfolioValue),
          dailyPnL: Math.round(dailyPnL),
          dailyPnLPct: Math.round(dailyPnLPct * 100) / 100,
        });

        prevValue = portfolioValue;
      }

      if (!cancelled) {
        // Override today's P&L with live value from dashboard
        if (todayPnL !== undefined) {
          const todayEntry = pnlEntries.find(e => e.date === today);
          if (todayEntry) {
            const prevEntry = pnlEntries[pnlEntries.indexOf(todayEntry) - 1];
            const prevValue = prevEntry?.portfolioValue ?? (todayEntry.portfolioValue - todayPnL);
            todayEntry.dailyPnL = Math.round(todayPnL);
            todayEntry.dailyPnLPct = Math.round((prevValue > 0 ? (todayPnL / prevValue) * 100 : 0) * 100) / 100;
          }
        }

        // En feriado, eliminar la entrada de hoy para no mostrar datos stale
        if (!hasDataFromToday) {
          pnlEntries = pnlEntries.filter(e => e.date !== today);
        }

        // Save resulting entries to Supabase by month (async, fire-and-forget, skip today)
        const byMonth = new Map<string, MonthlyPnLEntry[]>();
        for (const e of pnlEntries) {
          if (e.date === today) continue;
          const m = getMonthKey(e.date);
          if (!byMonth.has(m)) byMonth.set(m, []);
          byMonth.get(m)!.push(e);
        }
        for (const [m, entries] of byMonth) {
          supabaseService.saveMonthlyPnL(m, entries);
        }

        setEntries(pnlEntries);
        cacheRef.current = pnlEntries;
        lastHoldingsKeyRef.current = holdingsKey;
        sessionStorage.setItem('profitHistoryCache', JSON.stringify({ entries: pnlEntries, version: PNL_CACHE_VERSION }));
        localStorage.setItem('pnlCacheVersion', String(PNL_CACHE_VERSION));
        setIsLoading(false);
      }
    }

    load();
    return () => { cancelled = true; };
  }, [uniqueTickers, filter, customStart, customEnd, holdingsKey]);

  // Total P&L for the selected period: sum of daily changes (matches grid exactly)
  const totalPnL = entries.reduce((sum, e) => sum + e.dailyPnL, 0);
  const totalPnLPct = entries.length > 0 && entries[0].portfolioValue > 0
    ? (totalPnL / (entries[0].portfolioValue - entries[0].dailyPnL)) * 100
    : null;

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
      <div className="p-5 border-b border-slate-100">
        <h2 className="text-lg font-extrabold text-slate-900">Historial de Ganancias y Pérdidas</h2>
        <p className="text-xs text-slate-500 mt-1">Rendimiento diario desde la primera inversión</p>
      </div>

      {/* Filter bar */}
      <div className="px-5 py-3 border-b border-slate-100 bg-slate-50/50 flex flex-wrap items-center gap-2">
        {(['month', 'year', 'custom'] as DateFilter[]).map(f => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`px-3 py-1.5 text-xs font-bold rounded-lg transition cursor-pointer ${
              filter === f
                ? 'bg-teal-500 text-white shadow-sm'
                : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-100'
            }`}
          >
            {f === 'month' ? 'Mes' : f === 'year' ? 'Año' : 'Personalizado'}
          </button>
        ))}
        {filter === 'custom' && (
          <div className="flex items-center gap-2 ml-2">
            <input
              type="date"
              value={customStart}
              max={today}
              onChange={e => setCustomStart(e.target.value)}
              className="text-xs border border-slate-200 rounded-lg px-2 py-1.5"
            />
            <span className="text-xs text-slate-400">→</span>
            <input
              type="date"
              value={customEnd}
              max={today}
              onChange={e => setCustomEnd(e.target.value)}
              className="text-xs border border-slate-200 rounded-lg px-2 py-1.5"
            />
          </div>
        )}
      </div>

      {/* Summary */}
      {entries.length > 0 && (
        <div className="px-5 py-3 border-b border-slate-100 flex gap-6 text-sm">
          <div>
            <span className="text-slate-500 text-xs">Ganancia/Pérdida Total</span>
            <span className={`block text-lg font-extrabold font-mono ${totalPnL >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
              {totalPnL >= 0 ? '+' : ''}{formatCLP(totalPnL)}
            </span>
          </div>
          <div>
            <span className="text-slate-500 text-xs">Rendimiento Total</span>
            <span className={`block text-lg font-extrabold font-mono ${totalPnLPct == null ? 'text-slate-400' : totalPnLPct >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
              {totalPnLPct != null ? `${totalPnLPct >= 0 ? '+' : ''}${totalPnLPct.toFixed(2)}%` : '—'}
            </span>
          </div>
        </div>
      )}

      {/* Table */}
      <div className="overflow-y-auto max-h-[500px]">
        {isLoading ? (
          <div className="flex justify-center items-center py-16">
            <div className="w-8 h-8 border-4 border-slate-900 border-t-transparent rounded-full animate-spin"></div>
          </div>
        ) : entries.length === 0 ? (
          <div className="text-center py-16 text-slate-400 text-sm">
            {uniqueTickers.length === 0
              ? 'Agrega acciones a tu portafolio para ver el historial.'
              : 'No hay datos de precios históricos para las fechas seleccionadas.'}
          </div>
        ) : (
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-slate-50 text-slate-500 font-semibold uppercase tracking-wider sticky top-0">
                <th className="text-left py-3 px-4">Fecha</th>
                <th className="text-right py-3 px-4">Valor Cartera</th>
                <th className="text-right py-3 px-4">Cambio Diario</th>
                <th className="text-right py-3 px-4">Cambio %</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((e, i) => {
                const [y, m, d] = e.date.split('-');
                const formattedDate = `${d}/${m}/${y}`;
                return (
                  <tr key={e.date} className={`border-t border-slate-100 hover:bg-slate-50/50 ${i === entries.length - 1 ? 'font-bold bg-slate-50/80' : ''}`}>
                    <td className="py-2.5 px-4 text-slate-700 font-mono">{formattedDate}</td>
                    <td className="py-2.5 px-4 text-right font-mono text-slate-900">{formatCLP(e.portfolioValue)}</td>
                    <td className={`py-2.5 px-4 text-right font-mono ${e.dailyPnL >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
                      {e.dailyPnL >= 0 ? '+' : ''}{formatCLP(e.dailyPnL)}
                    </td>
                    <td className={`py-2.5 px-4 text-right font-mono ${e.dailyPnLPct >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
                      {e.dailyPnLPct >= 0 ? '+' : ''}{e.dailyPnLPct.toFixed(2)}%
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
