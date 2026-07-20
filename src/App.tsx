/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { X, Bell, AlertTriangle } from 'lucide-react';
import Header from './components/Header';
import MyPortfolio from './components/MyPortfolio';
import MarketWatch from './components/MarketWatch';
import DividendTracker from './components/DividendTracker';
import TaxRefunds from './components/TaxRefunds';
import ChartsAndAnalytics from './components/ChartsAndAnalytics';
import SupabaseSync from './components/SupabaseSync';
import LoginPage from './components/LoginPage';
import LandingPage from './components/LandingPage';
import HistoryPage from './components/HistoryPage';
import InvestmentPlan from './components/InvestmentPlan';
import { supabase } from './lib/supabase';
import { supabaseService } from './lib/supabaseService';
import { subscribeToChanges } from './lib/supabaseRealtime';
import { StockHolding, DividendPayment, TaxRefund, MarketStock, StockAlert } from './types';
import type { IntradayPoint } from './lib/intradaySnapshot';
import { normalizeTicker } from './utils';
import { autoSaveMissingDays } from './lib/dailySave';
import { saveIntradaySnapshot, loadIntradaySnapshots } from './lib/intradaySnapshot';

function dedupeCustomStocks(stocks: MarketStock[]): MarketStock[] {
  const seen = new Set<string>();
  return stocks
    .filter(cs => cs && cs.ticker)
    .map(cs => ({ ...cs, ticker: normalizeTicker(cs.ticker) }))
    .filter(cs => {
      if (seen.has(cs.ticker)) return false;
      seen.add(cs.ticker);
      return true;
    });
}

function mergeByUpdatedAt<T extends { id: string; updatedAt?: string }>(local: T[], cloud: T[]): T[] {
  const map = new Map<string, T>();
  for (const item of local) map.set(item.id, item);
  for (const item of cloud) {
    const existing = map.get(item.id);
    if (!existing || (existing.updatedAt || '') < (item.updatedAt || '')) {
      map.set(item.id, item);
    }
  }
  return Array.from(map.values());
}

export default function App() {
  // URL path to tab mapping for history mode routing
  const TAB_PATHS: Record<string, string> = {
    dashboard: '/dashboard', portfolio: '/portfolio', plan: '/plan',
    dividends: '/dividends', taxes: '/taxes', history: '/history',
    market: '/market', backup: '/backup',
  };
  const REVERSE_TABS: Record<string, string> = Object.fromEntries(
    Object.entries(TAB_PATHS).map(([k, v]) => [v, k])
  );

  // Active tab from URL path or localStorage fallback
  const [activeTab, setActiveTab] = useState<string>(() => {
    const path = window.location.pathname;
    const tabFromPath = REVERSE_TABS[path];
    if (tabFromPath) return tabFromPath;
    const saved = localStorage.getItem('activeTab');
    return saved || 'dashboard';
  });
  const [isLoading, setIsLoading] = useState<boolean>(true);

  // States initialized as empty arrays
  const [holdings, setHoldings] = useState<StockHolding[]>([]);
  const [dividends, setDividends] = useState<DividendPayment[]>([]);
  const [refunds, setRefunds] = useState<TaxRefund[]>([]);
  const [annualPerformancePercent, setAnnualPerformancePercent] = useState<number>(8.5);

  // Master market reference rates — only stocks the user explicitly searched for
  const [marketStocks, setMarketStocks] = useState<MarketStock[]>(() => {
    try {
      const saved = localStorage.getItem('custom_searched_stocks');
      const parsed = saved ? JSON.parse(saved) : [];
      if (Array.isArray(parsed) && parsed.length > 0) {
        return dedupeCustomStocks(parsed);
      }
    } catch (e) {
      console.warn('Error reading custom_searched_stocks:', e);
    }
    return [];
  });
  // Tracks which tickers the user explicitly searched for (for MarketWatch filter)
  const [searchedTickers, setSearchedTickers] = useState<Set<string>>(() => {
    try {
      const saved = localStorage.getItem('custom_searched_stocks');
      const parsed = saved ? JSON.parse(saved) : [];
      if (Array.isArray(parsed) && parsed.length > 0) {
        return new Set(parsed.map((s: MarketStock) => normalizeTicker(s.ticker)));
      }
    } catch {}
    return new Set();
  });
  const [isSyncingDividends, setIsSyncingDividends] = useState<boolean>(false);

  // Price alerts and voice/audio notifications state
  const [alerts, setAlerts] = useState<StockAlert[]>([]);
  const [supabaseIntradayData, setSupabaseIntradayData] = useState<IntradayPoint[] | null>(null);

  const [firedNotificationMessages, setFiredNotificationMessages] = useState<{ id: string; ticker: string; message: string }[]>([]);

  // Synthesized double-pitch notification chime
  const playAlertSound = () => {
    try {
      const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
      const now = ctx.currentTime;

      const osc1 = ctx.createOscillator();
      const osc2 = ctx.createOscillator();
      const gainNode = ctx.createGain();

      osc1.type = 'sine';
      osc1.frequency.setValueAtTime(523.25, now);
      osc1.frequency.exponentialRampToValueAtTime(783.99, now + 0.15);

      osc2.type = 'triangle';
      osc2.frequency.setValueAtTime(392.00, now);
      osc2.frequency.exponentialRampToValueAtTime(1046.50, now + 0.18);

      gainNode.gain.setValueAtTime(0.15, now);
      gainNode.gain.exponentialRampToValueAtTime(0.001, now + 1.2);

      osc1.connect(gainNode);
      osc2.connect(gainNode);
      gainNode.connect(ctx.destination);

      osc1.start(now);
      osc1.stop(now + 1.2);
      osc2.start(now);
      osc2.stop(now + 1.2);
    } catch (_e) {
      // Web Audio not available
    }
  };

  // Real-time auto-refresh trackers (persisted across refreshes)
  const [lastRefreshed, setLastRefreshed] = useState<Date>(() => {
    const stored = localStorage.getItem('lastRefreshed');
    if (stored) {
      const parsed = new Date(stored);
      if (!isNaN(parsed.getTime())) return parsed;
    }
    return new Date();
  });
  const [nextRefreshTime, setNextRefreshTime] = useState<number>(() => {
    const stored = localStorage.getItem('nextRefreshTime');
    if (stored) {
      const parsed = parseInt(stored, 10);
      if (!isNaN(parsed) && parsed > Date.now()) return parsed;
    }
    return Date.now() + 180000;
  });
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const [investmentPlanRefreshKey, setInvestmentPlanRefreshKey] = useState(0);
  const [syncError, setSyncError] = useState<string | null>(null);

  function trackSyncError(label: string, err: any) {
    const msg = err?.message || String(err || 'Error desconocido');
    console.warn(`sync ${label}:`, msg);
    setSyncError(`Error al sincronizar "${label}": ${msg}`);
    setTimeout(() => setSyncError(null), 10000);
  }

  // Persist user data to localStorage as fallback
  useEffect(() => { try { localStorage.setItem('holdings_backup', JSON.stringify(holdings)); } catch {} }, [holdings]);
  useEffect(() => { try { localStorage.setItem('dividends_backup', JSON.stringify(dividends)); } catch {} }, [dividends]);
  useEffect(() => { try { localStorage.setItem('refunds_backup', JSON.stringify(refunds)); } catch {} }, [refunds]);
  useEffect(() => { try { localStorage.setItem('alerts_backup', JSON.stringify(alerts)); } catch {} }, [alerts]);

  // Auto-update dividend amounts when holdings shares change
  const lastDividendSyncRef = useRef('');
  useEffect(() => {
    const key = holdings.map(h => `${h.ticker}:${h.shares}`).join('|');
    if (key === lastDividendSyncRef.current) return;
    lastDividendSyncRef.current = key;
    setDividends(prev => prev.map(d => {
      if (d.received) return d;
      const totalShares = holdings
        .filter(h => h.ticker === d.ticker)
        .reduce((sum, h) => sum + h.shares, 0);
      if (totalShares === 0 || totalShares === d.sharesCount) return d;
      return { ...d, sharesCount: totalShares, totalAmount: Math.round(totalShares * d.amountPerShare), estimated: true };
    }));
  }, [holdings]);

  // Ref for background refresh to always use latest holdings (avoids stale closure)
  const holdingsRef = useRef(holdings);
  holdingsRef.current = holdings;

  // Ref for searched tickers (so refresh closure reads latest value)
  const searchedTickersRef = useRef(searchedTickers);
  searchedTickersRef.current = searchedTickers;

  const refreshFnRef = useRef<((silent: boolean) => Promise<void>) | null>(null);

  // Prevents alert triggers from firing on fallback/initial data before first real API fetch
  const marketDataLoadedRef = useRef(false);
  const lastPortfolioValueRef = useRef(0);

  // Stocks manually hidden from the market overview
  const [deletedStocks, setDeletedStocks] = useState<string[]>(() => {
    try {
      const saved = localStorage.getItem('deleted_market_stocks');
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });

  useEffect(() => {
    localStorage.setItem('deleted_market_stocks', JSON.stringify(deletedStocks));
  }, [deletedStocks]);

  // Check alert triggers after each auto-refresh completes
  useEffect(() => {
    if (!marketDataLoadedRef.current || alerts.length === 0) return;
    const updatedAlerts = alerts.map(alert => {
      if (alert.triggered) return alert;
      const stock = marketStocks.find(s => s.ticker === alert.ticker);
      if (!stock) return alert;
      if (stock.price <= alert.targetPrice) {
        return { ...alert, triggered: true };
      }
      return alert;
    });
    const triggered = updatedAlerts.filter(a => a.triggered && !alerts.find(oa => oa.ticker === a.ticker)?.triggered);
    if (triggered.length > 0) {
      const newMessages = triggered.map(t => ({
        id: `${t.ticker}-${Date.now()}-${Math.random()}`,
        ticker: t.ticker,
        message: `La acción chilena ${t.ticker} ha caído bajo el precio límite de ${t.targetPrice.toLocaleString('es-CL', { style: 'currency', currency: 'CLP' })}. ¡Precio actual: ${(marketStocks.find(s => s.ticker === t.ticker)?.price || 0).toLocaleString('es-CL', { style: 'currency', currency: 'CLP' })}!`
      }));
      if (newMessages.length > 0) {
        playAlertSound();
        setFiredNotificationMessages(prev => [...prev, ...newMessages]);
      }
    }
    setAlerts(updatedAlerts);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lastRefreshed]);

  // Synchronize stock rates and indicator data in the background from Yahoo Finance
  const handleRefreshMarketData = async (silent: boolean = false) => {
    // After 18:00 CLT, skip refresh if portfolio value hasn't changed (Yahoo done for the day)
    const nowChile = new Date().toLocaleTimeString('en-US', { hour12: false, timeZone: 'America/Santiago' });
    const hourMin = parseInt(nowChile.slice(0, 2)) * 60 + parseInt(nowChile.slice(3, 5));
    if (hourMin >= 1080) {
      const currentValue = Math.round(holdingsRef.current.reduce((sum, h) => sum + (h.shares * h.currentPrice), 0));
      if (currentValue === lastPortfolioValueRef.current) return;
    }
    if (!silent) setIsRefreshing(true);
    try {
      // Collect additional tickers to fetch
      const additionalTickersSet = new Set<string>();
      
      // Load custom searched ones
      try {
        const saved = localStorage.getItem('custom_searched_stocks');
        const parsed = saved ? JSON.parse(saved) : [];
        if (Array.isArray(parsed)) {
          parsed.forEach((s: any) => {
            if (s && s.ticker) additionalTickersSet.add(s.ticker.toUpperCase());
          });
        }
      } catch (e) {
        console.warn('Error reading custom searched tickers in refresh:', e);
      }

      // Load owned ones
      const currentHoldings = holdingsRef.current;
      currentHoldings.forEach(h => {
        if (h && h.ticker) additionalTickersSet.add(h.ticker.toUpperCase());
      });

const standardTickers = ["CHILE", "SQM-B", "ENELCHILE", "CENCOSHOP", "COPEC", "VAPORES", "BSANTANDER", "CMPC", "FALABELLA", "ANDINA-B"];
      const additionalList = Array.from(additionalTickersSet)
        .filter(t => !standardTickers.includes(t));

      const queryUrl = additionalList.length > 0
        ? `/api/market-stocks?additional=${encodeURIComponent(additionalList.join(','))}`
        : '/api/market-stocks';

      const marketResponse = await fetch(queryUrl);
      if (marketResponse.ok) {
        const quotes = await marketResponse.json();
        if (quotes && quotes.length > 0) {
          const normalizedQuotes = quotes.map((q: any) => ({ ...q, ticker: normalizeTicker(q.ticker) }));
          // 1. Update Market reference list (all fetched quotes for pricing, but only user-searched ones for display)
          setMarketStocks(prev => {
            // Merge all fetched quotes into marketStocks so pricing/P&L works for owned stocks too
            const customStocks = prev.filter(p => !normalizedQuotes.some((q: any) => q.ticker === normalizeTicker(p.ticker)));
            const updatedList = [...normalizedQuotes, ...customStocks];
            
              // Only persist searched tickers to localStorage
              const searched = searchedTickersRef.current;
              const finalCustomSavedList = updatedList.filter(s => searched.has(s.ticker));
              if (finalCustomSavedList.length > 0) {
                try {
                  localStorage.setItem('custom_searched_stocks', JSON.stringify(finalCustomSavedList));
                } catch (e) {
                  console.warn('Error saving updated custom_searched_stocks:', e);
                }
              }
              return updatedList;
            });

            // 2. Refresh active holdings pricing (skip manually edited prices)
            setHoldings(prev => {
              return prev.map(h => {
                if (h.manualPrice) return h;
                const quote = normalizedQuotes.find((q: any) => q.ticker === normalizeTicker(h.ticker));
                if (!quote) return h;
                return {
                  ...h,
                  currentPrice: quote.price || h.currentPrice
                };
              });
            });
            const refreshedValue = currentHoldings.reduce((sum, h) => {
              const quote = normalizedQuotes.find((q: any) => normalizeTicker(q.ticker) === normalizeTicker(h.ticker));
              return sum + (h.shares * (quote?.price || h.currentPrice));
            }, 0);
            lastPortfolioValueRef.current = Math.round(refreshedValue);
            setLastRefreshed(new Date());
            setNextRefreshTime(Date.now() + 180000);
            setRefreshError(null);
            marketDataLoadedRef.current = true;

            // Save intraday snapshot for today's chart
            const snapshotValue = currentHoldings.reduce((sum, h) => {
              const quote = normalizedQuotes.find((q: any) => normalizeTicker(q.ticker) === normalizeTicker(h.ticker));
              const price = quote?.price || h.currentPrice;
              return sum + (h.shares * price);
            }, 0);
            saveIntradaySnapshot({
              time: new Date().toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Santiago', hour12: false }),
              timestamp: Date.now(),
              portfolioValue: snapshotValue,
              ipsaValue: 0,
            });

            // Backfill missing historical data (run once per day max)
            const lastBackfillKey = 'lastHistoryBackfill';
            const lastBackfill = localStorage.getItem(lastBackfillKey);
            const todayBackfill = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Santiago' });
            if (lastBackfill !== todayBackfill) {
              localStorage.setItem(lastBackfillKey, todayBackfill);
              const yesterday = new Date();
              yesterday.setDate(yesterday.getDate() - 1);
              const yesterdayStr = yesterday.toLocaleDateString('en-CA', { timeZone: 'America/Santiago' });
              // Fire-and-forget backfill
              const tickers = currentHoldings.map(h => h.ticker).filter(Boolean);
              if (tickers.length > 0) {
                const lastSavedDate = localStorage.getItem('lastPnLDate');
                if (lastSavedDate && lastSavedDate < yesterdayStr) {
                  fetch('/api/backfill-history', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ tickers, lastSavedDate })
                  }).catch(() => {});
                }
              }
            }
          } else {
          setRefreshError('La API respondió vacía. Los precios pueden estar desactualizados.');
          setNextRefreshTime(Date.now() + 180000);
        }
      } else {
        setRefreshError('Error al conectar con la API de mercado. Los precios pueden estar desactualizados.');
        setNextRefreshTime(Date.now() + 180000);
      }
    } catch (err) {
      console.warn('Error fetching live background updates:', err);
      setRefreshError('Error de red al actualizar precios. Los precios pueden estar desactualizados.');
      setNextRefreshTime(Date.now() + 180000);
    } finally {
      if (!silent) setIsRefreshing(false);
    }
  };

  // Persist lastRefreshed to localStorage on every change
  useEffect(() => {
    localStorage.setItem('lastRefreshed', lastRefreshed.toISOString());
  }, [lastRefreshed]);

  // Persist nextRefreshTime to localStorage on every change
  useEffect(() => {
    localStorage.setItem('nextRefreshTime', String(nextRefreshTime));
  }, [nextRefreshTime]);

  // Capture intraday snapshot whenever market data refreshes
  useEffect(() => {
    if (holdings.length === 0 || !marketDataLoadedRef.current) return;
    // Chilean market hours: 09:30 - 16:00. Only save snapshots within that window.
    const nowChile = new Date().toLocaleTimeString('en-US', { hour12: false, timeZone: 'America/Santiago' });
    const hourMin = parseInt(nowChile.slice(0, 2)) * 60 + parseInt(nowChile.slice(3, 5));
    if (hourMin < 570 || hourMin >= 960) return; // before 09:30 or after 16:00
    const value = holdings.reduce((sum, h) => sum + (h.shares * h.currentPrice), 0);
    const point: IntradayPoint = {
      time: new Date().toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Santiago', hour12: false }),
      timestamp: Date.now(),
      portfolioValue: Math.round(value),
      ipsaValue: 0,
    };
    saveIntradaySnapshot(point);
    // Also persist to Supabase for cross-session availability
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!session?.user) return;
      const todayDate = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Santiago' });
      supabaseService.pushIntradaySnapshots(todayDate, loadIntradaySnapshots()).catch(err => console.warn('Push snapshots error:', err));
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lastRefreshed]);

  // Keep ref updated with latest refresh function
  refreshFnRef.current = handleRefreshMarketData;

  // Setup periodic polling interval (automatic sync every 3 minutes)
  useEffect(() => {
    const interval = setInterval(() => {
      refreshFnRef.current?.(true); // Silent background refresh
    }, 180000);
    return () => clearInterval(interval);
  }, []);

  // Synchronize dividends from Chile corporate actions (Yahoo F.) based on holdings
  const handleSyncDividends = async (overrideHoldings?: StockHolding[]) => {
    const listToSync = overrideHoldings || holdings;
    if (listToSync.length === 0) return;

    setIsSyncingDividends(true);
    try {
      const response = await fetch('/api/sync-dividends', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          holdings: listToSync.map(h => ({
            ticker: h.ticker,
            buyDate: h.buyDate,
            shares: h.shares
          }))
        })
      });

      if (response.ok) {
        const synced: DividendPayment[] = await response.json();
        if (synced && synced.length > 0) {
            // Merge with current state dividends to preserve any existing user entries
            setDividends(prev => {
              const manuals = prev.filter(d => !d.id.startsWith('div-sys-'));
              const sysKeys = new Set(synced.map(s => `${s.ticker}-${s.payoutDate}-${s.cutoffDate || ''}`));
              
              // Remove manual records of the same ticker/date to avoid duplication
              const filteredManuals = manuals.filter(m => !sysKeys.has(`${m.ticker}-${m.payoutDate}-${m.cutoffDate || ''}`));
              const merged = [...synced, ...filteredManuals];
              return merged;
            });
        } else {
          console.warn('No se encontraron dividendos nuevos para tus acciones.');
        }
      } else {
        const errData = await response.text().catch(() => '');
        console.error(`Sync dividends error (${response.status}): ${errData}`);
      }
    } catch (err) {
      console.error('Error sincronizando dividendos desde bolsa:', err);
    } finally {
      setIsSyncingDividends(false);
    }
  };

  // Mount: check auth, load from Supabase, fetch market prices
  useEffect(() => {
    async function loadData() {
      try {
        // Restore from localStorage fallback immediately
        try {
          const savedHoldings = localStorage.getItem('holdings_backup');
          if (savedHoldings) { const p = JSON.parse(savedHoldings); if (Array.isArray(p)) setHoldings(p); }
        } catch {}
        try {
          const savedDividends = localStorage.getItem('dividends_backup');
          if (savedDividends) { const p = JSON.parse(savedDividends); if (Array.isArray(p)) setDividends(p); }
        } catch {}
        try {
          const savedRefunds = localStorage.getItem('refunds_backup');
          if (savedRefunds) { const p = JSON.parse(savedRefunds); if (Array.isArray(p)) setRefunds(p); }
        } catch {}
        try {
          const savedAlerts = localStorage.getItem('alerts_backup');
          if (savedAlerts) { const p = JSON.parse(savedAlerts); if (Array.isArray(p)) setAlerts(p); }
        } catch {}
        try {
          const savedPct = localStorage.getItem('annual_percent_backup');
          if (savedPct) setAnnualPerformancePercent(Number(savedPct));
        } catch {}

        const { data: { session } } = await supabase.auth.getSession();
        const user = session?.user ?? null;

        let cloud: Awaited<ReturnType<typeof supabaseService.pullAll>> | null = null;
        if (user) {
          cloud = await supabaseService.pullAll();
          // Merge cloud into local (localStorage-backed) state: newer updatedAt wins
          if (cloud.holdings.length > 0) {
            setHoldings(prev => mergeByUpdatedAt(prev, cloud!.holdings));
          }
          if (cloud.dividends.length > 0) {
            setDividends(prev => mergeByUpdatedAt(prev, cloud!.dividends));
          }
          if (cloud.refunds.length > 0) {
            setRefunds(prev => mergeByUpdatedAt(prev, cloud!.refunds));
          }
          if (cloud.alerts.length > 0) {
            setAlerts(prev => {
              const alertMap = new Map<string, StockAlert>(prev.map(a => [a.ticker, a]));
              for (const ca of cloud!.alerts) {
                const existing = alertMap.get(ca.ticker);
                if (!existing || (existing.updatedAt || '') < (ca.updatedAt || '')) {
                  alertMap.set(ca.ticker, ca);
                }
              }
              return Array.from(alertMap.values());
            });
          }
          if (cloud.settings?.annualPerformancePercent) setAnnualPerformancePercent(cloud.settings.annualPerformancePercent);
        }

        // Restore searched stocks from localStorage (user-preference, not user-data)
        try {
          const saved = localStorage.getItem('custom_searched_stocks');
          if (saved) {
            const parsed = JSON.parse(saved);
            if (Array.isArray(parsed) && parsed.length > 0) {
              const deduped = dedupeCustomStocks(parsed);
              setMarketStocks(deduped);
              setSearchedTickers(new Set(deduped.map(s => normalizeTicker(s.ticker))));
            }
          }
        } catch (e) {
          console.warn('Error reading custom_searched_stocks on mount:', e);
        }

        // Fetch real-time market stock prices from Yahoo DIRECTLY
        try {
          const additionalTickersSet = new Set<string>();
          try {
            const saved = localStorage.getItem('custom_searched_stocks');
            const parsed = saved ? JSON.parse(saved) : [];
            if (Array.isArray(parsed)) {
              parsed.forEach((s: any) => {
                if (s && s.ticker) additionalTickersSet.add(normalizeTicker(s.ticker));
              });
            }
          } catch (e) {
            console.warn('Error reading custom searched tickers on mount:', e);
          }

          const currentHoldings = cloud?.holdings || [];
          currentHoldings.forEach((h: StockHolding) => {
            if (h && h.ticker) additionalTickersSet.add(normalizeTicker(h.ticker));
          });

          const standardTickers = ["CHILE", "SQM-B", "ENELCHILE", "CENCOSHOP", "COPEC", "VAPORES", "BSANTANDER", "CMPC", "FALABELLA", "ANDINA-B"];
          const additionalList = Array.from(additionalTickersSet)
            .filter(t => !standardTickers.includes(t));

          const queryUrl = additionalList.length > 0
            ? `/api/market-stocks?additional=${encodeURIComponent(additionalList.join(','))}`
            : '/api/market-stocks';

          const marketResponse = await fetch(queryUrl);
          if (marketResponse.ok) {
            const quotes = await marketResponse.json();
            if (quotes && quotes.length > 0) {
              const normalizedQuotes = quotes.map((q: any) => ({ ...q, ticker: normalizeTicker(q.ticker) }));
              setMarketStocks(prev => {
                const customStocks = prev.filter(p => !normalizedQuotes.some((q: any) => q.ticker === normalizeTicker(p.ticker)));
                const updatedList = [...normalizedQuotes, ...customStocks];
                const saved = localStorage.getItem('custom_searched_stocks');
                let searched = new Set<string>();
                if (saved) {
                  try {
                    const parsed = JSON.parse(saved);
                    if (Array.isArray(parsed)) {
                      searched = new Set(parsed.map((s: any) => normalizeTicker(s.ticker)));
                    }
                  } catch {}
                }
                const finalCustomSavedList = updatedList.filter(s => searched.has(s.ticker));
                if (finalCustomSavedList.length > 0) {
                  try {
                    localStorage.setItem('custom_searched_stocks', JSON.stringify(finalCustomSavedList));
                  } catch (e) {
                    console.warn('Error saving updated custom_searched_stocks:', e);
                  }
                }
                return updatedList;
              });

              setHoldings(prev => {
                return prev.map(h => {
                  if (h.manualPrice) return h;
                  const quote = normalizedQuotes.find((q: any) => q.ticker === normalizeTicker(h.ticker));
                  if (!quote) return h;
                  return { ...h, currentPrice: quote.price || h.currentPrice };
                });
              });
              marketDataLoadedRef.current = true;
              setLastRefreshed(new Date());
              setNextRefreshTime(Date.now() + 180000);
              setRefreshError(null);
            }
          }
        } catch (apiErr) {
          console.warn('Could not fetch live stock quotes:', apiErr);
          setRefreshError('Error de red al obtener precios iniciales.');
        }

        // Load today's intraday snapshots from Supabase for immediate chart display
        if (user) {
          try {
            const todayDate = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Santiago' });
            const cloudSnapshots = await supabaseService.pullIntradaySnapshots(todayDate);
            if (cloudSnapshots.length > 0) {
              // Merge with localStorage snapshots (local wins for latest points)
              const localSnapshots = loadIntradaySnapshots();
              const tsSet = new Set(localSnapshots.map(p => p.timestamp));
              const merged = [...localSnapshots, ...cloudSnapshots.filter(p => !tsSet.has(p.timestamp))]
                .sort((a, b) => a.timestamp - b.timestamp);
              setSupabaseIntradayData(merged);
            }
          } catch (e) {
            console.warn('Error loading intraday from Supabase:', e);
          }
        }

        // Auto trigger dividend sync if user has holdings and no dividends
        if (user && (cloud?.holdings?.length || 0) > 0 && (cloud?.dividends?.length || 0) === 0) {
          const response = await fetch('/api/sync-dividends', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              holdings: (cloud?.holdings || []).map((h: StockHolding) => ({
                ticker: h.ticker,
                buyDate: h.buyDate,
                shares: h.shares
              }))
            })
          });
          if (response.ok) {
            const synced = await response.json();
            if (Array.isArray(synced) && synced.length > 0) {
              setDividends(prev => {
                const manuals = prev.filter(d => !d.id.startsWith('div-sys-'));
                const sysKeys = new Set(synced.map((s: any) => `${s.ticker}-${s.payoutDate}-${s.cutoffDate || ''}`));
                const filteredManuals = manuals.filter(m => !sysKeys.has(`${m.ticker}-${m.payoutDate}-${m.cutoffDate || ''}`));
                return [...synced, ...filteredManuals];
              });
            }
          }
        }
      } catch (err) {
        console.error('Error en inicialización:', err);
      } finally {
        setIsLoading(false);
      }
    }
    loadData();
  }, []);

  // Auto-save yesterday's portfolio data to Supabase after holdings load
  useEffect(() => {
    if (holdings.length > 0 && !isLoading) {
      autoSaveMissingDays(holdings);
    }
  }, [holdings.length > 0 && !isLoading]);

  const [supabaseUser, setSupabaseUser] = useState<any>(null);
  const [showLoginPage, setShowLoginPage] = useState(() => window.location.pathname === '/login');
  const [showLanding, setShowLanding] = useState(() => {
    const path = window.location.pathname;
    return path === '/' || (path !== '/login' && !REVERSE_TABS[path]);
  });
  const prevSessionRef = useRef<any>(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSupabaseUser(session?.user ?? null);
      prevSessionRef.current = session?.user ?? null;
      // Logged-in user on /login → go to dashboard
      if (session?.user && window.location.pathname === '/login') {
        setShowLoginPage(false);
        setShowLanding(false);
      }
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      const prev = prevSessionRef.current;
      const current = session?.user ?? null;
      prevSessionRef.current = current;
      setSupabaseUser(current);
      // Only dismiss login when user just signed in (responds to user action)
      if (current && !prev) {
        setShowLoginPage(false);
        setShowLanding(false);
      }
    });
    return () => subscription.unsubscribe();
  }, []);

  // Heartbeat: check session every 30s to detect silent token expiry
  useEffect(() => {
    if (!supabaseUser) return;
    const interval = setInterval(async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user && supabaseUser) {
        prevSessionRef.current = null;
        setSupabaseUser(null);
        setShowLoginPage(true);
      }
    }, 30000);
    return () => clearInterval(interval);
  }, [supabaseUser]);

  // Auto-sync from Supabase on mount (incremental per-entity)
  useEffect(() => {
    if (!supabaseUser || isLoading) return;

    const pullFromCloud = async () => {
      try {
        const cloud = await supabaseService.pullAll();
        let changed = false;

        // Merge holdings: Supabase wins if newer
        for (const ch of cloud.holdings) {
          setHoldings(prev => {
            const local = prev.find(h => h.id === ch.id);
            if (!local || (local.updatedAt || '') < (ch.updatedAt || '')) {
              changed = true;
              return prev.map(h => h.id === ch.id ? ch : h).concat(local ? [] : [ch]);
            }
            return prev;
          });
        }
        // Merge dividends
        for (const cd of cloud.dividends) {
          setDividends(prev => {
            const local = prev.find(d => d.id === cd.id);
            if (!local || (local.updatedAt || '') < (cd.updatedAt || '')) {
              changed = true;
              return prev.map(d => d.id === cd.id ? cd : d).concat(local ? [] : [cd]);
            }
            return prev;
          });
        }
        // Merge refunds
        for (const cr of cloud.refunds) {
          setRefunds(prev => {
            const local = prev.find(r => r.id === cr.id);
            if (!local || (local.updatedAt || '') < (cr.updatedAt || '')) {
              changed = true;
              return prev.map(r => r.id === cr.id ? cr : r).concat(local ? [] : [cr]);
            }
            return prev;
          });
        }
        // Merge alerts
        for (const ca of cloud.alerts) {
          setAlerts(prev => {
            const local = prev.find(a => a.ticker === ca.ticker);
            if (!local || (local.updatedAt || '') < (ca.updatedAt || '')) {
              changed = true;
              return local ? prev.map(a => a.ticker === ca.ticker ? ca : a) : [...prev, ca];
            }
            return prev;
          });
        }
        // Update settings
        if (cloud.settings?.annualPerformancePercent) {
          setAnnualPerformancePercent(cloud.settings.annualPerformancePercent);
          changed = true;
        }

        if (changed) {
          setInvestmentPlanRefreshKey(k => k + 1);
        }
      } catch (e) {
        console.warn('Auto-sync pull error:', e);
      }
    };

    const timer = setTimeout(pullFromCloud, 1500);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [supabaseUser, isLoading]);

  // Realtime subscriptions (live sync from Supabase)
  const unsubscribeRealtimeRef = useRef<(() => void) | null>(null);
  useEffect(() => {
    if (!supabaseUser) {
      unsubscribeRealtimeRef.current?.();
      unsubscribeRealtimeRef.current = null;
      return;
    }

    const cleanup = subscribeToChanges(supabaseUser.id, {
      onHoldingsChanged: (data) => { setHoldings(prev => mergeByUpdatedAt(prev, data)); },
      onDividendsChanged: (data) => { setDividends(prev => mergeByUpdatedAt(prev, data)); },
      onRefundsChanged: (data) => { setRefunds(prev => mergeByUpdatedAt(prev, data)); },
      onAlertsChanged: (data) => {
        setAlerts(prev => {
          const alertMap = new Map<string, StockAlert>(prev.map(a => [a.ticker, a]));
          for (const ca of data) {
            const existing = alertMap.get(ca.ticker);
            if (!existing || (existing.updatedAt || '') < (ca.updatedAt || '')) {
              alertMap.set(ca.ticker, ca);
            }
          }
          return Array.from(alertMap.values());
        });
      },
      onCustomStocksChanged: (data) => {
        const deduped = dedupeCustomStocks(data);
        setMarketStocks(deduped);
        setSearchedTickers(new Set(deduped.map(s => normalizeTicker(s.ticker))));
      },
      onSettingsChanged: async () => {
        const s = await supabaseService.pullSettings();
        if (s?.annualPerformancePercent) setAnnualPerformancePercent(s.annualPerformancePercent);
      },
      onInvestmentPlanChanged: () => {
        setInvestmentPlanRefreshKey(k => k + 1);
      }
    });
    unsubscribeRealtimeRef.current = cleanup;

    return () => {
      cleanup();
      unsubscribeRealtimeRef.current = null;
    };
  }, [supabaseUser]);

  // Handlers for Portfolio
  const handleAddHolding = async (newHolding: Omit<StockHolding, 'id'>) => {
    const normalizedTicker = normalizeTicker(newHolding.ticker);
    const id = `h-${Date.now()}`;
    const holding: StockHolding = { ...newHolding, id, ticker: normalizedTicker };

    // Always add to searched tickers so it appears in Bolsa de Santiago
    setSearchedTickers(prev => new Set(prev).add(normalizedTicker));
    
    // Ensure the ticker is in custom_searched_stocks for persistence
    const parsedStock: MarketStock = {
      ticker: normalizedTicker,
      name: newHolding.name || `${normalizedTicker} S.A.`,
      price: newHolding.buyPrice,
      changePercent: 0,
      dividendYield: newHolding.annualTargetYield || 6.0,
      sector: 'Portafolio Personal',
      volumeCLP: 1000000
    };

    try {
      const saved = localStorage.getItem('custom_searched_stocks');
      const parsed = saved ? JSON.parse(saved) : [];
      if (!parsed.some((s: MarketStock) => normalizeTicker(s.ticker) === normalizedTicker)) {
        parsed.push(parsedStock);
        localStorage.setItem('custom_searched_stocks', JSON.stringify(parsed));
      }
    } catch (e) {
      console.error('Error auto-persisting holding ticker as custom searched stock:', e);
    }

    setMarketStocks(prev => {
      if (prev.some(s => normalizeTicker(s.ticker) === normalizedTicker)) return prev;
      return [...prev, parsedStock];
    });

    // Optimistic UI state update
    const updatedHoldings = [...holdings, holding];
    setHoldings(updatedHoldings);
    try { localStorage.setItem('holdings_backup', JSON.stringify(updatedHoldings)); } catch {}
    // Sync to Supabase per-record
    supabaseService.syncHolding(holding).catch(e => trackSyncError('addHolding', e));

    // Auto sync actual dividends from the exchange!
    await handleSyncDividends(updatedHoldings);
  };

  const handleUpdateHoldingPrice = async (id: string, newPrice: number) => {
    let targetHolding: StockHolding | null = null;
    
    setHoldings(prev => prev.map(h => {
      if (h.id === id) {
        targetHolding = { ...h, currentPrice: newPrice, manualPrice: true };
        return targetHolding;
      }
      return h;
    }));

    if (targetHolding) {
      supabaseService.syncHolding({ ...targetHolding, manualPrice: true }).catch(e => trackSyncError('updatePrice', e));
      
      // Update corresponding reference price in market stock list
      setMarketStocks(prev => prev.map(m => {
        if (m.ticker === (targetHolding as any).ticker) {
          return { ...m, price: newPrice };
        }
        return m;
      }));
    }
  };

  const handleResetManualPrice = async (id: string) => {
    setHoldings(prev => prev.map(h => {
      if (h.id === id) {
        const updated = { ...h, manualPrice: false };
        supabaseService.syncHolding(updated).catch(e => trackSyncError('resetManual', e));
        return updated;
      }
      return h;
    }));
  };

  const handleUpdateHoldingYield = async (id: string, newYield: number) => {
    let targetHolding: StockHolding | null = null;
    
    setHoldings(prev => prev.map(h => {
      if (h.id === id) {
        targetHolding = { ...h, annualTargetYield: newYield };
        return targetHolding;
      }
      return h;
    }));

    if (targetHolding) {
      supabaseService.syncHolding(targetHolding).catch(e => trackSyncError('updateYield', e));
    }
  };

  const handleDeleteHolding = async (id: string) => {
    setHoldings(prev => prev.filter(h => h.id !== id));
    supabaseService.deleteHolding(id).catch(e => trackSyncError('deleteHolding', e));
  };

  // Handlers for Dividends
  const handleAddDividend = async (newDiv: Omit<DividendPayment, 'id'>) => {
    const id = `div-${Date.now()}`;
    const div: DividendPayment = { ...newDiv, id };
    
    setDividends(prev => [div, ...prev]);
    supabaseService.syncDividend(div).catch(e => trackSyncError('addDividend', e));
  };

  const handleUpdateDividend = async (id: string, updates: Partial<DividendPayment>) => {
    let updated: DividendPayment | null = null;
    setDividends(prev => prev.map(d => {
      if (d.id === id) {
        const amtPerShare = updates.amountPerShare ?? d.amountPerShare;
        // If editing a synced dividend, change its id so "Recuperar fechas" won't overwrite it
        const newId = d.id.startsWith('div-sys-') ? `div-${Date.now()}` : d.id;
        updated = { ...d, ...updates, id: newId, totalAmount: d.sharesCount * amtPerShare };
        return updated;
      }
      return d;
    }));
    if (updated) {
      if (id !== updated.id) {
        supabaseService.deleteDividend(id).catch(e => trackSyncError('deleteDividend', e));
      }
      supabaseService.syncDividend(updated).catch(e => trackSyncError('updateDividend', e));
    }
  };

  const handleToggleReceived = async (id: string) => {
    let targetDiv: DividendPayment | null = null;
    
    setDividends(prev => prev.map(d => {
      if (d.id === id) {
        // If toggling a synced dividend, change its id so sync won't overwrite it
        const newId = d.id.startsWith('div-sys-') ? `div-${Date.now()}` : d.id;
        targetDiv = { ...d, id: newId, received: !d.received };
        return targetDiv;
      }
      return d;
    }));

    if (targetDiv) {
      if (id !== targetDiv.id) {
        supabaseService.deleteDividend(id).catch(e => trackSyncError('deleteDividend', e));
      }
      supabaseService.syncDividend(targetDiv).catch(e => trackSyncError('toggleReceived', e));
    }
  };

  const handleDeleteDividend = async (id: string) => {
    setDividends(prev => prev.filter(d => d.id !== id));
    supabaseService.deleteDividend(id).catch(e => trackSyncError('deleteDividend', e));
  };

  // Handlers for Tax Refunds
  const handleAddRefund = async (newRefund: Omit<TaxRefund, 'id'>) => {
    const id = `tax-${Date.now()}`;
    const ref: TaxRefund = { ...newRefund, id };
    
    setRefunds(prev => [ref, ...prev]);
    supabaseService.syncRefund(ref).catch(e => trackSyncError('addRefund', e));
  };

  const handleDeleteRefund = async (id: string) => {
    setRefunds(prev => prev.filter(r => r.id !== id));
    supabaseService.deleteRefund(id).catch(e => trackSyncError('deleteRefund', e));
  };

  const handleSetAnnualPerformancePercent = async (val: number) => {
    setAnnualPerformancePercent(val);
    try { localStorage.setItem('annual_percent_backup', String(val)); } catch {}
    supabaseService.syncSettings({ annualPerformancePercent: val }).catch(e => trackSyncError('configuración', e));
  };


  // Backup file routines
  const handleExportBackup = async () => {
    try {
      const data = await supabaseService.exportBackup();
      const text = JSON.stringify(data, null, 2);
      const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
      
      const a = document.createElement('a');
      a.href = url;
      a.download = `santiago_bolsa_portafolio_backup_${new Date().toISOString().split('T')[0]}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error('Error exporting data: ', err);
      alert('Error al descargar el archivo de respaldo.');
    }
  };

  const handleImportBackup = async (content: string) => {
    try {
      const parsed = JSON.parse(content);
      await supabaseService.importBackup(parsed);

      // Reload states from Supabase
      const cloud = await supabaseService.pullAll();
      setHoldings(cloud.holdings);
      setDividends(cloud.dividends);
      setRefunds(cloud.refunds);
      if (cloud.alerts.length > 0) setAlerts(cloud.alerts);
      if (cloud.settings?.annualPerformancePercent) setAnnualPerformancePercent(cloud.settings.annualPerformancePercent);

      const customOnly = dedupeCustomStocks(cloud.customStocks);
      setMarketStocks(customOnly);
      const tickerSet = new Set(customOnly.map(s => normalizeTicker(s.ticker)));
      setSearchedTickers(tickerSet);

      try {
        localStorage.setItem('custom_searched_stocks', JSON.stringify(customOnly));
      } catch (e) {
        console.warn('Error saving updated custom_stocks on import:', e);
      }
    } catch (err) {
      console.error('Error importing backup:', err);
      throw err;
    }
  };

  const handleClearAllData = async () => {
    try {
      await supabaseService.clearAllData();
      setHoldings([]);
      setDividends([]);
      setRefunds([]);
      setAnnualPerformancePercent(8.5);
      setMarketStocks([]);
      setSearchedTickers(new Set());
      try {
        localStorage.removeItem('custom_searched_stocks');
      } catch (e) {
        console.warn(e);
      }
      try { localStorage.removeItem('investment_plan_backup'); } catch {}
    } catch (err) {
      console.error('Error clearing data:', err);
      alert('No se pudo borrar los datos locales.');
    }
  };

  const handleMarketQuickBuy = async (tickerCode: string) => {
    const stock = marketStocks.find(s => s.ticker === tickerCode);
    if (!stock) return;
    const quickHolding: Omit<StockHolding, 'id'> = {
      ticker: stock.ticker,
      name: stock.name,
      shares: 1,
      buyPrice: stock.price,
      currentPrice: stock.price,
      buyDate: new Date().toISOString().split('T')[0],
      annualTargetYield: stock.dividendYield
    };
    await handleAddHolding(quickHolding);
  };

  const handleToggleAlert = (ticker: string, currentPrice: number) => {
    setAlerts(prev => {
      const exists = prev.find(a => a.ticker === ticker);
      if (exists) {
        const updated = prev.filter(a => a.ticker !== ticker);
        supabaseService.deleteAlert(ticker).catch(e => trackSyncError('deleteAlert', e));
        return updated;
      }
      const newAlert: StockAlert = { ticker, targetPrice: currentPrice * 0.95, starredPrice: currentPrice, triggered: false };
      supabaseService.syncAlert(newAlert).catch(e => trackSyncError('addAlert', e));
      return [...prev, newAlert];
    });
  };

  const handleUpdateTargetPrice = (ticker: string, targetPrice: number) => {
    setAlerts(prev => prev.map(a => {
      if (a.ticker === ticker) {
        const updated = { ...a, targetPrice };
        supabaseService.syncAlert(updated).catch(e => trackSyncError('updateTarget', e));
        return updated;
      }
      return a;
    }));
  };

  const handleResetAlert = (ticker: string) => {
    const stock = marketStocks.find(s => s.ticker === ticker);
    if (!stock) return;
    setAlerts(prev => prev.map(a => {
      if (a.ticker === ticker) {
        const updated = { ...a, targetPrice: stock.price * 0.95, triggered: false, starredPrice: stock.price };
        supabaseService.syncAlert(updated).catch(e => trackSyncError('resetAlert', e));
        return updated;
      }
      return a;
    }));
  };

  const handleDeleteMarketStock = (ticker: string) => {
    setDeletedStocks(prev => {
      if (prev.includes(ticker)) return prev;
      return [...prev, ticker];
    });
  };

  const handleRefreshSingleStock = async (ticker: string) => {
    try {
      const res = await fetch(`/api/market-stocks?additional=${encodeURIComponent(ticker)}`);
      if (res.ok) {
        const data = await res.json();
        if (data && data.length > 0) {
          const fresh = data[0];
          if (fresh.ticker) {
            fresh.ticker = normalizeTicker(fresh.ticker);
            setMarketStocks(prev => prev.map(s => s.ticker === fresh.ticker ? { ...s, ...fresh } : s));
          }
        }
      }
    } catch { /* silent */ }
  };

  const handleRestoreAllMarketStocks = () => {
    setDeletedStocks([]);
  };

  const handleSearchAndAddStock = (newStock: MarketStock) => {
    const normalizedTicker = normalizeTicker(newStock.ticker);
    const normalizedStock = { ...newStock, ticker: normalizedTicker };

    // Track this ticker as user-searched
    setSearchedTickers(prev => new Set(prev).add(normalizedTicker));

    // Save custom searched stock back to localStorage so it persists across reloads
    try {
      const saved = localStorage.getItem('custom_searched_stocks');
      const parsed = saved ? JSON.parse(saved) : [];
      if (!parsed.some((s: MarketStock) => s.ticker === normalizedTicker)) {
        parsed.push(normalizedStock);
        localStorage.setItem('custom_searched_stocks', JSON.stringify(parsed));
      }
    } catch (e) {
      console.error('Error saving searched stock to custom_searched_stocks cache:', e);
    }

    // Sync custom stock to Supabase per-record
    supabaseService.syncCustomStock(normalizedStock).catch(e => trackSyncError('customStock', e));

    setMarketStocks(prev => {
      if (prev.some(s => s.ticker === normalizedTicker)) return prev;
      return [...prev, normalizedStock];
    });
  };

  useEffect(() => {
    const speed = 0.7;
    const handler = (e: WheelEvent) => {
      const target = (e.currentTarget as HTMLElement);
      e.preventDefault();
      target.scrollBy({ top: e.deltaY * speed, behavior: 'smooth' });
    };
    const observer = new MutationObserver(() => {
      document.querySelectorAll<HTMLElement>('.table-scroll-container').forEach(el => {
        if (!el.dataset.smoothScroll) {
          el.dataset.smoothScroll = 'true';
          el.addEventListener('wheel', handler, { passive: false });
        }
      });
    });
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, []);

  const handleTabChange = (tab: string) => {
    setActiveTab(tab);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  // History mode routing: sync URL with state
  useEffect(() => {
    const path = TAB_PATHS[activeTab] || '/dashboard';
    window.history.replaceState(null, '', showLanding ? '/' : showLoginPage ? '/login' : path);
    localStorage.setItem('activeTab', activeTab);
  }, [activeTab, showLanding, showLoginPage]);

  // Handle browser back/forward buttons
  useEffect(() => {
    const onPopState = () => {
      const path = window.location.pathname;
      if (path === '/') { setShowLanding(true); setShowLoginPage(false); }
      else if (path === '/login') { setShowLanding(false); setShowLoginPage(true); }
      else {
        const tab = REVERSE_TABS[path];
        if (tab) { setActiveTab(tab); setShowLanding(false); setShowLoginPage(false); }
      }
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  // Calculations
  const todayStr = new Date().toISOString().split('T')[0];
  const portfolioValuation = holdings.reduce((sum, h) => sum + (h.shares * h.currentPrice), 0);
  const totalContributed = holdings.reduce((sum, h) => sum + (h.shares * h.buyPrice), 0);
  const totalDividends = dividends.filter(d => d.received).reduce((sum, d) => sum + d.totalAmount, 0);
  const totalTaxRefunds = refunds.reduce((sum, r) => sum + r.amount, 0);
  // Si ningún activo tiene datos de hoy (feriado, fin de semana), el P&L es 0
  const hasDataFromToday = marketStocks.some(s => s.marketDate === todayStr);
  const dailyPnL = hasDataFromToday ? holdings.reduce((sum, h) => {
    if (h.buyDate && h.buyDate >= todayStr) return sum;
    const stock = marketStocks.find(s => normalizeTicker(s.ticker) === normalizeTicker(h.ticker));
    if (stock && stock.price > 0) {
      if (stock.previousClose != null && stock.previousClose > 0) {
        return sum + (h.shares * (stock.price - stock.previousClose));
      }
      if (stock.changePercent != null) {
        const pct = stock.changePercent / 100;
        const changePerShare = stock.price * pct / (1 + pct);
        return sum + (h.shares * changePerShare);
      }
    }
    return sum;
  }, 0) : 0;

  // Portfolio value at market open (using previousClose as approximate open price)
  const portfolioOpenValue = holdings.reduce((sum, h) => {
    const stock = marketStocks.find(s => normalizeTicker(s.ticker) === normalizeTicker(h.ticker));
    const openPrice = stock?.previousClose && stock.previousClose > 0 ? stock.previousClose : h.currentPrice;
    return sum + (h.shares * openPrice);
  }, 0);

  const ownedTickers = new Set(holdings.map(h => normalizeTicker(h.ticker)));
  const ownedMarketStocks = marketStocks.filter(s => ownedTickers.has(normalizeTicker(s.ticker)));

  const sectorAllocation = (() => {
    const map = new Map<string, { value: number; tickers: string[] }>();
    for (const h of holdings) {
      const stock = marketStocks.find(s => normalizeTicker(s.ticker) === normalizeTicker(h.ticker));
      const sector = stock?.sector || 'No clasificado';
      if (!map.has(sector)) map.set(sector, { value: 0, tickers: [] });
      const entry = map.get(sector)!;
      entry.value += h.shares * h.currentPrice;
      entry.tickers.push(h.ticker);
    }
    const totalValue = Array.from(map.values()).reduce((a, e) => a + e.value, 0);
    return Array.from(map.entries()).map(([sector, data]) => ({
      sector, value: data.value, tickers: data.tickers,
      count: data.tickers.length,
      percentage: totalValue > 0 ? (data.value / totalValue) * 100 : 0
    }));
  })();

  const handleLogin = (cloudData?: any) => {
    setShowLoginPage(false);
    if (cloudData) {
      setHoldings(cloudData.holdings || []);
      setDividends(cloudData.dividends || []);
      setRefunds(cloudData.refunds || []);
      if (cloudData.annualPerformancePercent) setAnnualPerformancePercent(cloudData.annualPerformancePercent);
      if (cloudData.customStocks?.length) {
        const deduped = dedupeCustomStocks(cloudData.customStocks);
        setMarketStocks(deduped);
        setSearchedTickers(new Set(deduped.map((s: MarketStock) => normalizeTicker(s.ticker))));
        try { localStorage.setItem('custom_searched_stocks', JSON.stringify(deduped)); } catch {}
      }
      if (cloudData.alerts?.length) setAlerts(cloudData.alerts);
    }
  };

  const handleLandingStart = () => {
    setShowLanding(false);
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!session?.user) setShowLoginPage(true);
    });
  };

  return (
    showLanding ? (
      <LandingPage onStart={handleLandingStart} />
    ) : showLoginPage ? (
      <LoginPage onLogin={handleLogin} />
    ) : (
    <div className="min-h-screen bg-slate-50 flex flex-col font-sans selection:bg-teal-500 selection:text-slate-900"
      onTouchStart={(e) => {
        const el = e.currentTarget;
        el.dataset.touchX = e.touches[0].clientX.toString();
        el.dataset.touchY = e.touches[0].clientY.toString();
        // Ignore swipe if touch started inside a horizontally scrollable element
        let node = e.target as HTMLElement | null;
        let inScrollable = false;
        while (node && node !== el) {
          const style = getComputedStyle(node);
          if (style.overflowX === 'auto' || style.overflowX === 'scroll') {
            if (node.scrollWidth > node.clientWidth) { inScrollable = true; break; }
          }
          node = node.parentElement;
        }
        el.dataset.ignoreSwipe = inScrollable ? '1' : '0';
      }}
      onTouchEnd={(e) => {
        const el = e.currentTarget;
        if (el.dataset.ignoreSwipe === '1') return;
        const startX = parseFloat(el.dataset.touchX || '0');
        const startY = parseFloat(el.dataset.touchY || '0');
        const endX = e.changedTouches[0].clientX;
        const endY = e.changedTouches[0].clientY;
        const dX = endX - startX;
        const dY = endY - startY;
        if (Math.abs(dX) < 50 || Math.abs(dX) < Math.abs(dY) * 2) return;
        const tabs = ['dashboard', 'portfolio', 'plan', 'dividends', 'taxes', 'history', 'market', 'backup'];
        const idx = tabs.indexOf(activeTab);
        if (dX < 0 && idx < tabs.length - 1) handleTabChange(tabs[idx + 1]);
        if (dX > 0 && idx > 0) handleTabChange(tabs[idx - 1]);
      }}>
      <Header
        activeTab={activeTab}
        setActiveTab={handleTabChange}
        portfolioValue={portfolioValuation}
        nextRefreshTime={nextRefreshTime}
      />

      <main className="flex-1 max-w-[1400px] w-full mx-auto p-4 md:p-6 lg:p-8">
        {syncError && (
          <div className="mb-4 p-3 bg-rose-50 border border-rose-200 rounded-xl text-[11px] text-rose-800 flex items-start gap-2 shadow-sm">
            <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5 text-rose-500" />
            <div>
              <span className="font-bold block">Error de sincronización</span>
              <span>{syncError}</span>
            </div>
            <button onClick={() => setSyncError(null)} className="ml-auto shrink-0 text-rose-400 hover:text-rose-600 cursor-pointer">
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}
        {isLoading ? (
          <div className="min-h-[50vh] flex flex-col items-center justify-center space-y-4">
            <div className="w-10 h-10 border-4 border-slate-900 border-t-transparent rounded-full animate-spin"></div>
            <p className="text-xs text-slate-500 font-medium">Iniciando base de datos local y cargando portafolio chileno...</p>
          </div>
        ) : (
          <div className="space-y-6">

            {/* API Error Banner */}
            {refreshError && (
              <div className="bg-rose-50 border border-rose-200 rounded-xl p-3 shadow-xs flex items-start justify-between gap-3">
                <div className="flex items-center space-x-2.5">
                  <div className="w-7 h-7 rounded-full bg-rose-100 flex items-center justify-center text-rose-500 shrink-0">
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" /></svg>
                  </div>
                  <p className="text-xs text-rose-700 font-medium">{refreshError}</p>
                </div>
                <button
                  onClick={() => setRefreshError(null)}
                  className="text-rose-400 hover:text-rose-600 p-1 rounded-lg transition shrink-0 cursor-pointer"
                  title="Cerrar"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            )}

            {/* Active Fired Price Alerts List Banner */}
            {firedNotificationMessages.length > 0 && (
              <div className="space-y-2 animate-fadeIn">
                {firedNotificationMessages.map((msg) => (
                  <div key={msg.id} className="bg-amber-50 border border-amber-300 rounded-xl p-3 shadow-sm flex items-start justify-between gap-3">
                    <div className="flex items-start space-x-2.5">
                      <div className="w-8 h-8 rounded-full bg-amber-200 flex items-center justify-center text-amber-700 shrink-0">
                        <Bell className="w-4 h-4" />
                      </div>
                      <div>
                        <p className="text-xs font-bold text-slate-800">Alerta de Variación de Precio Sonoro</p>
                        <p className="text-xs text-slate-600 mt-0.5">{msg.message}</p>
                      </div>
                    </div>
                    <button
                      onClick={() => setFiredNotificationMessages(prev => prev.filter(m => m.id !== msg.id))}
                      className="text-amber-400 hover:text-amber-600 p-1 rounded-lg transition shrink-0 cursor-pointer"
                      title="Cerrar"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            )}

            <AnimatePresence mode="wait">
            <motion.div
              key={activeTab}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -12 }}
              transition={{ duration: 0.2 }}
              className="w-full"
            >
              <div className={activeTab === 'dashboard' ? '' : 'hidden'}>
                <ChartsAndAnalytics
                  holdings={holdings}
                  contributedCapital={totalContributed}
                  totalDividends={totalDividends}
                  totalTaxRefunds={totalTaxRefunds}
                  annualPerformancePercentage={annualPerformancePercent}
                  setAnnualPerformancePercentage={handleSetAnnualPerformancePercent}
                  holdingsCount={holdings.length}
                  dailyPnL={dailyPnL}
                  sectorAllocation={sectorAllocation}
                  portfolioOpenValue={portfolioOpenValue}
                  supabaseIntradayData={supabaseIntradayData}
                />
              </div>

              <div className={activeTab === 'portfolio' ? '' : 'hidden'}>
                <MyPortfolio
                  holdings={holdings}
                  onAddHolding={handleAddHolding}
                  onUpdateHoldingPrice={handleUpdateHoldingPrice}
                  onUpdateHoldingYield={handleUpdateHoldingYield}
                  onDeleteHolding={handleDeleteHolding}
                  onResetManualPrice={handleResetManualPrice}
                  marketStocks={ownedMarketStocks}
                  dailyPnL={dailyPnL}
                  onSearchAndAddStock={handleSearchAndAddStock}
                />
              </div>

              <div className={activeTab === 'market' ? '' : 'hidden'}>
                <MarketWatch
                  marketStocks={marketStocks.filter(s => searchedTickers.has(s.ticker) && !deletedStocks.includes(s.ticker))}
                  onQuickBuy={handleMarketQuickBuy}
                  holdings={holdings}
                  onSearchAndAddStock={handleSearchAndAddStock}
                  onDeleteStock={handleDeleteMarketStock}
                  onRefreshStock={handleRefreshSingleStock}
                  deletedStocksCount={deletedStocks.length}
                  onRestoreAllStocks={handleRestoreAllMarketStocks}
                  nextRefreshTime={nextRefreshTime}
                  alerts={alerts}
                  onToggleAlert={handleToggleAlert}
                  onUpdateTargetPrice={handleUpdateTargetPrice}
                  onResetAlert={handleResetAlert}
                />
              </div>

              <div className={activeTab === 'plan' ? '' : 'hidden'}>
                <InvestmentPlan
                  marketStocks={ownedMarketStocks}
                  holdings={holdings}
                  refreshKey={investmentPlanRefreshKey}
                />
              </div>

              <div className={activeTab === 'dividends' ? '' : 'hidden'}>
                <DividendTracker
                  dividends={dividends}
                  onAddDividend={handleAddDividend}
                  onUpdateDividend={handleUpdateDividend}
                  onToggleReceived={handleToggleReceived}
                  onDeleteDividend={handleDeleteDividend}
                  holdings={holdings}
                  onSyncDividends={() => handleSyncDividends()}
                  isSyncing={isSyncingDividends}
                />
              </div>

              <div className={activeTab === 'taxes' ? '' : 'hidden'}>
                <TaxRefunds
                  refunds={refunds}
                  onAddRefund={handleAddRefund}
                  onDeleteRefund={handleDeleteRefund}
                />
              </div>

              <div className={activeTab === 'history' ? '' : 'hidden'}>
                <HistoryPage holdings={holdings} dividends={dividends} todayPnL={dailyPnL} hasDataFromToday={hasDataFromToday} />
              </div>

              <div className={activeTab === 'backup' ? '' : 'hidden'}>
                <SupabaseSync
                  onImport={async (data: any) => {
                    try {
                      await supabaseService.importBackup(data);
                      const cloud = await supabaseService.pullAll();
                      setHoldings(cloud.holdings);
                      setDividends(cloud.dividends);
                      setRefunds(cloud.refunds);
                      if (cloud.alerts.length > 0) setAlerts(cloud.alerts);
                      if (cloud.settings?.annualPerformancePercent) setAnnualPerformancePercent(cloud.settings.annualPerformancePercent);

                      const customOnly = dedupeCustomStocks(cloud.customStocks);
                      setMarketStocks(customOnly);
                      const tickerSet = new Set(customOnly.map(s => normalizeTicker(s.ticker)));
                      setSearchedTickers(tickerSet);
                      try {
                        localStorage.setItem('custom_searched_stocks', JSON.stringify(customOnly));
                      } catch (e) {
                        console.warn('Error saving updated custom_stocks on cloud restore:', e);
                      }

                      if (data.alerts) {
                        setAlerts(data.alerts);
                      }
                      if (data.deletedTickers) {
                        setDeletedStocks(data.deletedTickers);
                        localStorage.setItem('deleted_market_stocks', JSON.stringify(data.deletedTickers));
                      }

                      handleTabChange('dashboard');
                    } catch (err) {
                      console.error('Error al importar datos:', err);
                    }
                  }}
                  getBackupData={() => {
                    return {
                      holdings,
                      dividends,
                      refunds,
                      annualPerformancePercent,
                      deletedTickers: deletedStocks,
                      customStocks: marketStocks.filter(s => !["CHILE","SQM-B","ENELCHILE","CENCOSHOP","COPEC","VAPORES","BSANTANDER","CMPC","FALABELLA","ANDINA-B"].includes(s.ticker)),
                      alerts,
                      exportedAt: new Date().toISOString()
                    };
                  }}
                  onExportBackup={handleExportBackup}
                  onImportBackup={handleImportBackup}
                  onClearAllData={handleClearAllData}
                />
              </div>
            </motion.div>
          </AnimatePresence>
          </div>
        )}
      </main>

      <footer className="bg-slate-900 text-slate-500 text-[10px] py-3 px-4 border-t border-slate-800 text-center w-full mt-12">
        <p>Software libre para la <span className="text-slate-400">Comunidad Financiera de Chile</span>. Datos con fines educativos e informativos &mdash; no constituye asesoría de inversión. <span className="text-slate-400">#InversiónConsciente</span></p>
      </footer>
    </div>
  )
  );
}
