import { supabaseService } from './supabaseService';
import type { MonthlyPnLEntry } from './supabase';
import type { StockHolding } from '../types';

function getDateStr(d: Date): string {
  return d.toLocaleDateString('en-CA', { timeZone: 'America/Santiago' });
}

function getMonthKey(dateStr: string): string {
  return dateStr.substring(0, 7);
}

export async function autoSaveMissingDays(holdings: StockHolding[]): Promise<void> {
  if (holdings.length === 0) return;
  const tickers = [...new Set(holdings.map(h => h.ticker))].sort();
  if (tickers.length === 0) return;

  const today = getDateStr(new Date());

  // Find the last completed trading day (yesterday, or Friday if today is Monday)
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayStr = getDateStr(yesterday);

  // Skip weekends — no market data expected
  const dow = yesterday.getDay();
  if (dow === 0 || dow === 6) return;

  // Check if yesterday is already saved
  const months = [getMonthKey(yesterdayStr)];
  const cached = await supabaseService.pullMonthlyPnL(months);
  const existingDates = new Set<string>();
  for (const m of months) {
    if (cached[m]) {
      for (const e of cached[m]) existingDates.add(e.date);
    }
  }
  if (existingDates.has(yesterdayStr)) return;

  // Fetch server data for last 3 business days to get enough context for P&L
  const threeDaysAgo = new Date();
  threeDaysAgo.setDate(threeDaysAgo.getDate() - 5);
  const startStr = getDateStr(threeDaysAgo);

  let tickerPrices: Map<string, Map<string, number>> = new Map();
  try {
    const res = await fetch(`/api/portfolio-history?tickers=${encodeURIComponent(tickers.join(','))}&startDate=${startStr}&endDate=${yesterdayStr}`);
    if (res.ok) {
      const data: { ticker: string; history: { date: string; close: number }[] }[] = await res.json();
      for (const item of data) {
        if (item.history.length === 0) continue;
        const dateMap = new Map<string, number>();
        for (const h of item.history) dateMap.set(h.date, h.close);
        tickerPrices.set(item.ticker, dateMap);
      }
    }
  } catch {
    return;
  }

  // Collect all dates from ticker data
  const allDates = new Set<string>();
  for (const [, dateMap] of tickerPrices) {
    for (const date of dateMap.keys()) {
      if (date >= yesterdayStr && date <= yesterdayStr) allDates.add(date);
    }
  }
  if (!allDates.has(yesterdayStr)) return;

  // Compute portfolio values using last known price to fill gaps
  const lastKnownPrice = new Map<string, number>();
  const computeVal = (date: string): number => {
    let val = 0;
    for (const h of holdings) {
      if (h.buyDate > date) continue;
      const priceMap = tickerPrices.get(h.ticker);
      if (!priceMap) continue;
      const close = priceMap.get(date);
      if (close != null && close > 0) {
        val += h.shares * close;
        lastKnownPrice.set(h.ticker, close);
      } else {
        const fallback = lastKnownPrice.get(h.ticker);
        if (fallback != null) val += h.shares * fallback;
      }
    }
    return val;
  };

  const yesterdayVal = computeVal(yesterdayStr);
  if (yesterdayVal === 0) return;

  // Get the most recent entry before yesterday from Supabase for P&L calc
  let prevValue = 0;
  const prevDates = Array.from(existingDates).sort().reverse();
  for (const pd of prevDates) {
    if (pd < yesterdayStr) {
      // find it in cached data
      for (const m of months) {
        if (cached[m]) {
          const found = cached[m].find(e => e.date === pd);
          if (found) { prevValue = found.portfolioValue; break; }
        }
      }
      if (prevValue > 0) break;
    }
  }

  // If no previous value from Supabase, try to compute from server data
  if (prevValue === 0) {
    // Find the closest date before yesterday that has price data
    const sortedDates = Array.from(allDates).sort();
    const idx = sortedDates.indexOf(yesterdayStr);
    if (idx > 0) {
      prevValue = computeVal(sortedDates[idx - 1]);
    }
  }

  const dailyPnL = prevValue > 0 ? yesterdayVal - prevValue : 0;
  const dailyPnLPct = prevValue > 0 ? (dailyPnL / prevValue) * 100 : 0;

  const entry: MonthlyPnLEntry = {
    date: yesterdayStr,
    portfolioValue: Math.round(yesterdayVal),
    dailyPnL: Math.round(dailyPnL),
    dailyPnLPct: Math.round(dailyPnLPct * 100) / 100,
  };

  // Merge with existing data for the month and save
  const month = getMonthKey(yesterdayStr);
  const existing = cached[month] || [];
  const existingWithoutYesterday = existing.filter(e => e.date !== yesterdayStr);
  existingWithoutYesterday.push(entry);
  existingWithoutYesterday.sort((a, b) => a.date.localeCompare(b.date));

  await supabaseService.saveMonthlyPnL(month, existingWithoutYesterday);
}
