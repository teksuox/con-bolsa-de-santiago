import React, { useState, useEffect, useRef } from 'react';
import { formatCLP } from '../utils';
import { TrendingUp, Award, PieChart, AlertTriangle, HelpCircle, BarChart3 } from 'lucide-react';
import { StockHolding, SectorAllocation } from '../types';
import { supabaseService } from '../lib/supabaseService';
import type { MonthlyPnLEntry } from '../lib/supabase';
import { loadIntradaySnapshots, IntradayPoint } from '../lib/intradaySnapshot';

interface ChartsAndAnalyticsProps {
  holdings?: StockHolding[];
  contributedCapital: number;
  totalDividends: number;
  totalTaxRefunds: number;
  annualPerformancePercentage: number;
  setAnnualPerformancePercentage: (val: number) => void;
  holdingsCount: number;
  dailyPnL: number;
  sectorAllocation?: SectorAllocation[];
  portfolioOpenValue?: number;
}

interface ChartEntry {
  date: string;
  portfolioValue: number;
  dailyPnL: number;
  dailyPnLPct: number;
}

type ChartRange = 'week' | 'month' | 'year';

  function getDateStr(d: Date): string {
    return d.toLocaleDateString('en-CA', { timeZone: 'America/Santiago' });
  }

  function withoutToday(entries: ChartEntry[]): ChartEntry[] {
    const today = getDateStr(new Date());
    return entries.filter(e => e.date !== today);
  }

export default function ChartsAndAnalytics({
  holdings = [],
  contributedCapital,
  totalDividends,
  totalTaxRefunds,
  annualPerformancePercentage,
  setAnnualPerformancePercentage,
  holdingsCount,
  dailyPnL,
  sectorAllocation = [],
  portfolioOpenValue = 0,
}: ChartsAndAnalyticsProps) {
  const [chartRange, setChartRange] = useState<ChartRange>('month');
  const [chartData, setChartData] = useState<ChartEntry[]>([]);
  const [loadingChart, setLoadingChart] = useState(false);
  const [hoveredPointIdx, setHoveredPointIdx] = useState<number | null>(null);
  const [debugInfo, setDebugInfo] = useState({ startStr: '', endStr: '', count: 0, firstDate: '' });
  const chartCacheRef = useRef<Record<string, ChartEntry[]>>({});

  const [intradayData, setIntradayData] = useState<IntradayPoint[]>([]);
  const [hoveredIntradayIdx, setHoveredIntradayIdx] = useState<number | null>(null);
  const [ipsaHistory, setIpsaHistory] = useState<ChartEntry[]>([]);
  const [ipsaLoading, setIpsaLoading] = useState(false);



  // Build intraday data: synthetic 09:30 point + real snapshots + optional Yahoo backfill
  const holdingsRef = useRef(holdings);
  holdingsRef.current = holdings;

  useEffect(() => {
    const snapshots = loadIntradaySnapshots();
    let data: IntradayPoint[] = [...snapshots];

    if (data.length > 0 && portfolioOpenValue > 0) {
      const [fh, fm] = data[0].time.split(':').map(Number);
      if (fh > 9 || (fh === 9 && fm > 30)) {
        data.unshift({
          time: '09:30',
          timestamp: new Date(data[0].timestamp).setHours(9, 30, 0, 0),
          portfolioValue: Math.round(portfolioOpenValue),
          ipsaValue: 0,
        });
      }
    }

    setIntradayData(data);

    // Backfill missing hours from Yahoo if there's a gap
    const active = holdingsRef.current.filter(h => h.shares > 0);
    if (data.length > 1 && active.length > 0 && portfolioOpenValue > 0) {
      const gap = data[1].timestamp - data[0].timestamp;
      if (gap > 600000) {
        const tickers = [...new Set(active.map(h => h.ticker))].join(',');
        const shares = active.map(h => h.shares);
        fetch(`/api/intraday-prices?tickers=${encodeURIComponent(tickers)}`)
          .then(r => r.ok ? r.json() : null)
          .then((result: any) => {
            if (!Array.isArray(result) || result.length === 0) return;
            const sharesByTicker: Record<string, number> = {};
            for (const h of holdingsRef.current) sharesByTicker[h.ticker] = (sharesByTicker[h.ticker] || 0) + h.shares;
            const activeTickers = Object.keys(sharesByTicker);
            // Build timestamp -> per-ticker price map
            const rawMap = new Map<number, Record<string, number>>();
            for (const entry of result) {
              if (!entry.prices) continue;
              for (const p of entry.prices) {
                if (!rawMap.has(p.ts)) rawMap.set(p.ts, {});
                rawMap.get(p.ts)![entry.ticker] = p.close;
              }
            }
            // Only include timestamps where ALL active tickers have a non-zero price
            const tsMap = new Map<number, number>();
            for (const [ts, tickerPrices] of rawMap) {
              const missingTicker = activeTickers.some(t => !tickerPrices[t] || tickerPrices[t] <= 0);
              if (missingTicker) continue;
              let val = 0;
              for (const [tkr, price] of Object.entries(tickerPrices)) {
                val += (sharesByTicker[tkr] || 0) * price;
              }
              tsMap.set(ts, val);
            }
            const sorted = Array.from(tsMap.entries()).sort((a, b) => a[0] - b[0]);
            if (sorted.length === 0) return;
            // Normalize: shift all yahoo values so first complete one matches portfolioOpenValue
            const firstYahooVal = sorted[0][1];
            const cutoff = snapshots[0]?.timestamp ?? Infinity;
            const before: IntradayPoint[] = [];
            for (const [ts, val] of sorted) {
              if (ts >= cutoff) break;
              const adjusted = portfolioOpenValue + (val - firstYahooVal);
              before.push({
                time: new Date(ts).toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Santiago', hour12: false }),
                timestamp: ts,
                portfolioValue: Math.round(adjusted),
                ipsaValue: 0,
              });
            }
            if (before.length > 0) {
              setIntradayData([...before, ...snapshots]);
            }
          })
          .catch(() => {});
      }
    }
  }, [portfolioOpenValue]);

  // Poll for new snapshots every 30s
  useEffect(() => {
    const interval = setInterval(() => {
      const current = loadIntradaySnapshots();
      if (current.length === 0) return;
      setIntradayData(prev => {
        const existingTs = new Set(prev.map(p => p.timestamp));
        const newPoints = current.filter(p => !existingTs.has(p.timestamp));
        if (newPoints.length === 0) return prev;
        return [...prev, ...newPoints].sort((a, b) => a.timestamp - b.timestamp);
      });
    }, 30000);
    return () => clearInterval(interval);
  }, []);

  // Fetch IPSA history from findic.cl via server
  useEffect(() => {
    if (holdings.length === 0) return;
    setIpsaLoading(true);
    fetch('/api/ipsa-history')
      .then(res => res.ok ? res.json() : { history: [] })
      .then((data: any) => {
        const history = data?.history || [];
        if (history.length > 0) {
          const ipsaPoints: ChartEntry[] = history.map((d: any) => ({
            date: d.date,
            portfolioValue: Math.round(d.close),
            dailyPnL: 0,
            dailyPnLPct: 0,
          }));
          ipsaPoints.sort((a: any, b: any) => a.date.localeCompare(b.date));
          setIpsaHistory(ipsaPoints);
          // Save latest IPSA value to localStorage for daily tracking
          const latest = ipsaPoints[ipsaPoints.length - 1];
          try {
            const stored: { date: string; value: number }[] = JSON.parse(localStorage.getItem('ipsaDailyHistory') || '[]');
            const existing = stored.findIndex(e => e.date === latest.date);
            if (existing >= 0) stored[existing] = { date: latest.date, value: latest.portfolioValue };
            else stored.push({ date: latest.date, value: latest.portfolioValue });
            localStorage.setItem('ipsaDailyHistory', JSON.stringify(stored));
          } catch {}
        }
      })
      .catch(() => {})
      .finally(() => setIpsaLoading(false));
  }, [holdings]);

  useEffect(() => {
    if (holdings.length === 0) return;
    const key = holdings.map(h => `${h.ticker}:${h.shares}`).join('|') + '|' + chartRange;
    if (chartCacheRef.current[key]) {
      setChartData(chartCacheRef.current[key]);
      return;
    }
    const now = new Date();
    let start: Date;
    switch (chartRange) {
      case 'week': start = new Date(now.getTime() - 7 * 86400000); break;
      case 'month': start = new Date(now.getFullYear(), now.getMonth(), 1); break;
      case 'year': {
        const dates = holdings.map(h => new Date(h.buyDate).getTime()).filter(d => !isNaN(d));
        const earliestBuy = dates.length > 0 ? new Date(Math.min(...dates)) : new Date(0);
        const janFirst = new Date(now.getFullYear(), 0, 1);
        // Si la primera compra fue en un año anterior, empieza el 1ro de enero
        // Si fue este año, empieza desde la fecha de compra
        start = earliestBuy.getFullYear() < now.getFullYear() ? janFirst : earliestBuy;
        break;
      }
      default: start = new Date(now.getTime() - 30 * 86400000);
    }
    const startStr = getDateStr(start);
    const endStr = getDateStr(now);
    setLoadingChart(true);

    async function load() {
      // 1. Try sessionStorage cache
      try {
        const cachedRaw = sessionStorage.getItem('profitHistoryCache');
        if (cachedRaw) {
          const parsed = JSON.parse(cachedRaw);
          const all: ChartEntry[] = (parsed.entries || []).map((e: any) => ({
            date: e.date, portfolioValue: Math.round(e.portfolioValue), dailyPnL: e.dailyPnL || 0, dailyPnLPct: e.dailyPnLPct || 0
          }));
          all.sort((a: any, b: any) => a.date.localeCompare(b.date));
          const filtered = all.filter((e: any) => e.date >= startStr && e.date <= endStr);
          const firstDataDate = filtered[0]?.date || '';
          const gapDays = firstDataDate
            ? Math.round((new Date(firstDataDate).getTime() - new Date(startStr).getTime()) / 86400000)
            : 999;
          if (filtered.length > 1 && gapDays <= 3) {
            const noToday = withoutToday(filtered);
            chartCacheRef.current[key] = noToday;
            setChartData(noToday);
            setDebugInfo({ startStr, endStr, count: noToday.length, firstDate: noToday[0]?.date || '—' });
            return;
          }
        }
      } catch { /* fall through */ }

      // 2. Try Supabase monthly_pnl (primary source — same data as Historial page)
      let fromServer = false;
      let merged: ChartEntry[] = [];
      try {
        const monthsNeeded: string[] = [];
        const d = new Date(start);
        while (d <= now) {
          const m = d.toLocaleDateString('en-CA', { timeZone: 'America/Santiago' }).substring(0, 7);
          if (!monthsNeeded.includes(m)) monthsNeeded.push(m);
          d.setMonth(d.getMonth() + 1);
        }
        const cached = await supabaseService.pullMonthlyPnL(monthsNeeded);
        const allEntries: MonthlyPnLEntry[] = [];
        for (const m of monthsNeeded) if (cached[m]) allEntries.push(...cached[m]);
        merged = allEntries
          .filter(e => e.date >= startStr && e.date <= endStr)
          .map(e => ({ date: e.date, portfolioValue: Math.round(e.portfolioValue), dailyPnL: e.dailyPnL || 0, dailyPnLPct: e.dailyPnLPct || 0 }));
        merged.sort((a, b) => a.date.localeCompare(b.date));
        const supFirst = merged[0]?.date || '';
        const supGap = supFirst
          ? Math.round((new Date(supFirst).getTime() - new Date(startStr).getTime()) / 86400000)
          : 999;
        if (merged.length < 2 || supGap > 3) fromServer = true;
      } catch { fromServer = true; }

      // 3. If Supabase didn't have enough data, fall back to server endpoint (Yahoo)
      if (fromServer) {
        merged = [];
        try {
          const tickers = [...new Set(holdings.map(h => h.ticker))].join(',');
          const res = await fetch(`/api/portfolio-history?tickers=${encodeURIComponent(tickers)}&startDate=${startStr}&endDate=${endStr}`);
          const data: any = await res.json();
          if (Array.isArray(data)) {
            const sharesMap: Record<string, number> = {};
            for (const h of holdings) sharesMap[h.ticker] = (sharesMap[h.ticker] || 0) + h.shares;
            const dateMap: Record<string, number> = {};
            for (const entry of data) {
              if (!entry.history) continue;
              for (const day of entry.history) {
                const val = (sharesMap[entry.ticker] || 0) * day.close;
                dateMap[day.date] = (dateMap[day.date] || 0) + val;
              }
            }
            for (const [date, portfolioValue] of Object.entries(dateMap).sort((a, b) => a[0].localeCompare(b[0]))) {
              merged.push({ date, portfolioValue: Math.round(portfolioValue as number), dailyPnL: 0, dailyPnLPct: 0 });
            }
          }
        } catch { /* server failed */ }
      }

      const noToday = withoutToday(merged);
      if (noToday.length > 1) {
        chartCacheRef.current[key] = noToday;
        setChartData(noToday);
        setDebugInfo({ startStr, endStr, count: noToday.length, firstDate: noToday[0]?.date || '—' });
        return;
      }

      setChartData([]);
      setDebugInfo({ startStr, endStr, count: 0, firstDate: '—' });
    }

    load().finally(() => setLoadingChart(false));
  }, [chartRange, holdings]);

  const listHoldings = holdings || [];
  const computedContributed = listHoldings.reduce((sum, h) => sum + (h.shares * h.buyPrice), 0);
  const computedCurrentValue = listHoldings.reduce((sum, h) => sum + (h.shares * h.currentPrice), 0);

  const totalLosses = listHoldings.reduce((sum, h) => {
    const diff = h.currentPrice - h.buyPrice;
    return diff < 0 ? sum + (Math.abs(diff) * h.shares) : sum;
  }, 0);
  const totalGains = listHoldings.reduce((sum, h) => {
    const diff = h.currentPrice - h.buyPrice;
    return diff > 0 ? sum + (diff * h.shares) : sum;
  }, 0);
  const netCapitalGainOrLoss = computedCurrentValue - computedContributed;
  const isNetGain = netCapitalGainOrLoss >= 0;
  const holdingsWithLosses = listHoldings.filter(h => h.currentPrice < h.buyPrice);
  const holdingsWithGains = listHoldings.filter(h => h.currentPrice > h.buyPrice);
  const generatedYieldPercent = contributedCapital > 0 
    ? ((totalDividends + totalTaxRefunds) / contributedCapital) * 100 : 0;

  // First purchase date for "Desde Inicio" comparison
  const earliestBuyDate = listHoldings.length > 0
    ? listHoldings.map(h => h.buyDate).filter(Boolean).sort()[0] || null
    : null;

  // Total portfolio return since inception
  const totalReturnPct = computedContributed > 0 ? ((computedCurrentValue - computedContributed) / computedContributed) * 100 : null;

  // IPSA return since first purchase
  const ipsaSinceInicio = (() => {
    if (!earliestBuyDate || ipsaHistory.length < 2) return null;
    const startEntry = ipsaHistory.find(e => e.date >= earliestBuyDate);
    const lastEntry = ipsaHistory[ipsaHistory.length - 1];
    if (!startEntry || !lastEntry || startEntry.portfolioValue <= 0) return null;
    return ((lastEntry.portfolioValue - startEntry.portfolioValue) / startEntry.portfolioValue) * 100;
  })();

  // Compute IPSA daily change from history
  const ipsaDailyChange = (() => {
    if (ipsaHistory.length < 2) return null;
    const last = ipsaHistory[ipsaHistory.length - 1].portfolioValue;
    const prev = ipsaHistory[ipsaHistory.length - 2].portfolioValue;
    if (prev <= 0) return null;
    return ((last - prev) / prev) * 100;
  })();

  // Compute monthly changes (MTD) for portfolio and IPSA
  const monthlyChange = (() => {
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0];
    // Portfolio from chartData
    const monthEntries = chartData.filter(e => e.date >= monthStart && e.date <= getDateStr(now));
    const pfFirst = monthEntries.length > 0 ? monthEntries[0].portfolioValue : 0;
    const pfLast = monthEntries.length > 0 ? monthEntries[monthEntries.length - 1].portfolioValue : 0;
    const pfPct = pfFirst > 0 ? ((pfLast - pfFirst) / pfFirst) * 100 : null;
    // IPSA from ipsaHistory + localStorage daily tracking
    const ipsaMonth = ipsaHistory.filter(e => e.date >= monthStart);
    // Also load locally tracked daily values for dates not in ipsaHistory
    let additionalIpsa: { date: string; value: number }[] = [];
    try { additionalIpsa = JSON.parse(localStorage.getItem('ipsaDailyHistory') || '[]').filter((e: any) => e.date >= monthStart && !ipsaMonth.some((i: any) => i.date === e.date)); } catch {}
    const allIpsa = [...ipsaMonth.map(e => ({ date: e.date, value: e.portfolioValue })), ...additionalIpsa].sort((a, b) => a.date.localeCompare(b.date));
    const ipsaFirst = allIpsa.length > 0 ? allIpsa[0].value : 0;
    const ipsaLast = allIpsa.length > 0 ? allIpsa[allIpsa.length - 1].value : 0;
    const ipsaPct = ipsaFirst > 0 ? ((ipsaLast - ipsaFirst) / ipsaFirst) * 100 : null;
    return { pfPct, ipsaPct, hasMonthly: allIpsa.length >= 2 };
  })();

  // Compute year-by-year returns for IPSA and portfolio
  const yearlyReturns = (() => {
    const years = new Set<number>();
    for (const e of ipsaHistory) {
      const y = parseInt(e.date.slice(0, 4), 10);
      if (!isNaN(y) && y >= 2019 && y <= 2026) years.add(y);
    }
    return Array.from(years).sort((a, b) => b - a).map(year => {
      const entries = ipsaHistory.filter(e => e.date.startsWith(String(year)));
      const ipsaFirst = entries.length > 0 ? entries[0].portfolioValue : 0;
      const ipsaLast = entries.length > 0 ? entries[entries.length - 1].portfolioValue : 0;
      const ipsaPct = ipsaFirst > 0 ? ((ipsaLast - ipsaFirst) / ipsaFirst) * 100 : null;
      // Portfolio from chartData for this year
      const pfEntries = chartData.filter(e => e.date.startsWith(String(year)));
      const pfFirst = pfEntries.length > 0 ? pfEntries[0].portfolioValue : 0;
      const pfLast = pfEntries.length > 0 ? pfEntries[pfEntries.length - 1].portfolioValue : 0;
      const pfPct = pfFirst > 0 ? ((pfLast - pfFirst) / pfFirst) * 100 : null;
      return { year, ipsaPct, pfPct, hasPf: pfEntries.length >= 2 };
    });
  })();

  // Area chart SVG
  const renderAreaChart = () => {
    if (loadingChart) {
      return <div className="flex items-center justify-center h-48 text-xs text-slate-400">Cargando...</div>;
    }
    if (!Array.isArray(chartData) || chartData.length < 2) {
      return <div className="flex items-center justify-center h-48 text-xs text-slate-400">Sin datos suficientes para el período</div>;
    }
    const values = chartData.map(d => d.portfolioValue);
    const minVal = Math.min(...values);
    const maxVal = Math.max(...values);
    const range = maxVal - minVal || 1;
    const w = 700;
    const h = 200;
    const padT = 16;
    const padB = 20;
    const padL = 0;
    const padR = 0;
    const chartW = w - padL - padR;
    const chartH = h - padT - padB;
    const stepX = chartW / (chartData.length - 1);
    const points = values.map((v, i) => ({
      x: padL + i * stepX,
      y: padT + chartH - ((v - minVal) / range) * chartH,
    }));
    const areaPath = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ') +
      ` L${points[points.length - 1].x},${padT + chartH} L${points[0].x},${padT + chartH} Z`;
    const linePath = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');

    const lastVal = values[values.length - 1];
    const firstVal = values[0];
    const change = lastVal - firstVal;
    const changePct = firstVal > 0 ? (change / firstVal) * 100 : 0;

    // Y-axis labels
    const yLabels = [0, 0.25, 0.5, 0.75, 1].map(pct => ({
      value: minVal + range * pct,
      y: padT + chartH - pct * chartH,
    }));

    return (
      <div>
        <div className="flex items-baseline gap-3 mb-2">
          <div className="text-[10px] text-slate-400 font-mono">
            [{debugInfo.startStr}→{debugInfo.endStr}] datos:{debugInfo.count} 1er:{debugInfo.firstDate}
          </div>
          <span className="text-lg font-extrabold font-mono text-slate-900">{formatCLP(lastVal)}</span>
          <span className={`text-xs font-bold font-mono ${netCapitalGainOrLoss >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
            {netCapitalGainOrLoss >= 0 ? '+' : ''}{formatCLP(netCapitalGainOrLoss)} ({((netCapitalGainOrLoss / (computedContributed || 1)) * 100).toFixed(2)}%)
          </span>
        </div>
        <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-48" preserveAspectRatio="none"
          onMouseMove={(e) => {
            const rect = e.currentTarget.getBoundingClientRect();
            const xPos = e.clientX - rect.left;
            const svgW = rect.width;
            const frac = (xPos / svgW) * w;
            const chartFrac = (frac - padL) / chartW;
            let idx = Math.round(chartFrac * (points.length - 1));
            idx = Math.max(0, Math.min(points.length - 1, idx));
            setHoveredPointIdx(idx);
          }}
          onMouseLeave={() => setHoveredPointIdx(null)}>
          <defs>
            <linearGradient id="areaGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={change >= 0 ? '#14b8a6' : '#ef4444'} stopOpacity="0.25" />
              <stop offset="100%" stopColor={change >= 0 ? '#14b8a6' : '#ef4444'} stopOpacity="0.02" />
            </linearGradient>
          </defs>
          <path d={areaPath} fill="url(#areaGrad)" />
          <path d={linePath} fill="none" stroke={change >= 0 ? '#14b8a6' : '#ef4444'} strokeWidth="2.5" />
          {hoveredPointIdx !== null && (() => {
            const p = points[hoveredPointIdx];
            if (!p) return null;
            return (
              <g>
                <line x1={p.x} y1={padT} x2={p.x} y2={padT + chartH} stroke="#94a3b8" strokeWidth="1" strokeDasharray="2 2" />
                <circle cx={p.x} cy={p.y} r="5" fill="#0f172a" stroke={change >= 0 ? '#2dd4bf' : '#fb7185'} strokeWidth="2" />
              </g>
            );
          })()}
          {(() => {
            const step = Math.max(1, Math.floor(points.length / 8));
            return points.map((p, idx) => {
              if (idx % step !== 0 && idx !== points.length - 1) return null;
              return (
                <g key={idx}>
                  <circle cx={p.x} cy={p.y} r="2.5" fill={change >= 0 ? '#14b8a6' : '#ef4444'} pointerEvents="none" />
                </g>
              );
            });
          })()}
        </svg>
        <div className="h-6 mt-1 flex items-center justify-center">
          {hoveredPointIdx !== null && chartData[hoveredPointIdx] ? (
            (() => {
              const d = chartData[hoveredPointIdx];
              const dailyChange = d.dailyPnL || 0;
              return (
                <div className="bg-slate-900 text-teal-300 text-[10.5px] font-mono font-bold px-3 py-0.5 rounded-full shadow-md flex items-center gap-1.5">
                  <span className="text-white">{d.date}:</span>
                  <span className="font-extrabold">{formatCLP(d.portfolioValue)}</span>
                  <span className={`${dailyChange >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                    ({dailyChange >= 0 ? '+' : ''}{formatCLP(dailyChange)})
                  </span>
                </div>
              );
            })()
          ) : (
            <span className="text-[10px] text-slate-400 italic flex items-center gap-1">
              <HelpCircle className="w-3.5 h-3.5 text-slate-300" />
              Mueve el mouse por el gráfico para ver el precio de cada día.
            </span>
          )}
        </div>
      </div>
    );
  };

  // Render intraday chart (today's P&L movement)
  const renderIntradayChart = () => {
    if (intradayData.length < 1) return null;
    const openVal = intradayData[0].portfolioValue;
    const lastVal = intradayData[intradayData.length - 1].portfolioValue;
    const pnl = lastVal - openVal;
    const pnlPct = openVal > 0 ? (pnl / openVal) * 100 : 0;

    if (intradayData.length < 2) {
    return (
      <div>
          <div className="flex items-baseline gap-3 mb-1">
            <span className={`text-xs font-extrabold font-mono ${pnl >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
              {pnl >= 0 ? '+' : ''}{formatCLP(pnl)}
            </span>
            <span className="text-[9px] text-slate-400">esperando datos...</span>
          </div>
        </div>
      );
    }

    // Convert to P&L relative to open
    const pnlValues = intradayData.map(d => d.portfolioValue - openVal);
    const maxPnl = Math.max(...pnlValues, 1);
    const minPnl = Math.min(...pnlValues, -1);
    const range = Math.max(maxPnl - minPnl, 1);

    const vbW = 700;
    const vbH = 100;
    const padT = 8;
    const padB = 16;
    const chartW = vbW;
    const chartH = vbH - padT - padB;
    const stepX = chartW / (intradayData.length - 1);

    // Find y coordinate for zero line
    const zeroY = padT + chartH - ((0 - minPnl) / range) * chartH;

    const points = pnlValues.map((v, i) => ({
      x: i * stepX,
      y: padT + chartH - ((v - minPnl) / range) * chartH,
    }));
    const linePath = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
    const areaPath = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ') +
      ` L${points[points.length - 1].x},${padT + chartH} L${points[0].x},${padT + chartH} Z`;

    const labelStep = Math.max(1, Math.floor(intradayData.length / 6));

    return (
      <div>
        <div className="flex items-baseline gap-3 mb-1">
          <span className={`text-base font-extrabold font-mono ${pnl >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
            {pnl >= 0 ? '+' : ''}{formatCLP(pnl)}
          </span>
          <span className={`text-sm font-bold font-mono ${pnl >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
            ({pnlPct >= 0 ? '+' : ''}{pnlPct.toFixed(2)}%)
          </span>
          <span className="text-xs text-slate-400">hoy, {intradayData.length}pts</span>
        </div>
        <svg viewBox={`0 0 ${vbW} ${vbH}`} style={{ width: '100%', aspectRatio: `${vbW}/${vbH}`, display: 'block' }}
          onMouseMove={(e) => {
            const rect = e.currentTarget.getBoundingClientRect();
            const xPos = e.clientX - rect.left;
            const frac = xPos / rect.width;
            let idx = Math.round(frac * (intradayData.length - 1));
            idx = Math.max(0, Math.min(intradayData.length - 1, idx));
            setHoveredIntradayIdx(idx);
          }}
          onMouseLeave={() => setHoveredIntradayIdx(null)}>
          <defs>
            <linearGradient id="intradayAreaGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={pnl >= 0 ? '#14b8a6' : '#ef4444'} stopOpacity="0.25" />
              <stop offset="100%" stopColor={pnl >= 0 ? '#14b8a6' : '#ef4444'} stopOpacity="0.02" />
            </linearGradient>
          </defs>
          {/* Zero line */}
          <line x1={0} y1={zeroY} x2={vbW} y2={zeroY} stroke="#cbd5e1" strokeWidth="0.5" strokeDasharray="3 3" />
          <path d={areaPath} fill="url(#intradayAreaGrad)" />
          <path d={linePath} fill="none" stroke={pnl >= 0 ? '#14b8a6' : '#ef4444'} strokeWidth="2.5" />
          {(() => {
            return points.map((p, idx) => {
              if (idx % labelStep !== 0 && idx !== points.length - 1) return null;
              return (
                <g key={idx}>
                  <circle cx={p.x} cy={p.y} r="2" fill={pnl >= 0 ? '#14b8a6' : '#ef4444'} />
                </g>
              );
            });
          })()}
          {hoveredIntradayIdx !== null && points[hoveredIntradayIdx] && (
            <g>
              <line x1={points[hoveredIntradayIdx].x} y1={padT} x2={points[hoveredIntradayIdx].x} y2={padT + chartH} stroke="#94a3b8" strokeWidth="1" strokeDasharray="2 2" />
              <circle cx={points[hoveredIntradayIdx].x} cy={points[hoveredIntradayIdx].y} r="5" fill="#0f172a" stroke={pnl >= 0 ? '#2dd4bf' : '#fb7185'} strokeWidth="2" />
            </g>
          )}
        </svg>
        <div className="h-5 mt-0.5 flex items-center justify-center">
          {hoveredIntradayIdx !== null && intradayData[hoveredIntradayIdx] ? (
            (() => {
              const d = intradayData[hoveredIntradayIdx];
              const pointPnl = d.portfolioValue - openVal;
              const pointPnlPct = openVal > 0 ? (pointPnl / openVal) * 100 : 0;
              return (
                <div className="bg-slate-900 text-teal-300 text-[10.5px] font-mono font-bold px-3 py-0.5 rounded-full shadow-md flex items-center gap-1.5">
                  <span className="text-white">{d.time}:</span>
                  <span className={pointPnl >= 0 ? 'text-emerald-400' : 'text-rose-400'}>
                    {pointPnl >= 0 ? '+' : ''}{formatCLP(pointPnl)} ({pointPnlPct >= 0 ? '+' : ''}{pointPnlPct.toFixed(2)}%)
                  </span>
                </div>
              );
            })()
          ) : (
            <span className="text-[8px] text-slate-400 italic flex items-center gap-1">
              <HelpCircle className="w-3 h-3 text-slate-300" />
              Mueve el mouse para ver la plusvalía
            </span>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-3">
      {/* Header compacto */}
      <div className="flex items-center space-x-1.5 text-indigo-600">
        <Award className="w-4 h-4" />
        <h3 className="font-bold text-slate-800 text-xs">Resumen del Portafolio</h3>
      </div>

      {/* Fila de métricas compactas */}
      <div className="grid grid-cols-2 md:grid-cols-6 gap-2">
        <div className="bg-white p-3 rounded-xl border border-slate-200 flex flex-col justify-center">
          <span className="text-[10px] text-slate-400 block leading-tight">Capital</span>
          <span className="text-base font-extrabold font-mono text-slate-900">{formatCLP(computedContributed)}</span>
          <span className="text-[10px] text-slate-400 block leading-tight mt-1.5">Mercado</span>
          <span className="text-base font-extrabold font-mono text-indigo-600">{formatCLP(computedCurrentValue)}</span>
        </div>
        <div className="bg-white p-3 rounded-xl border border-slate-200">
          <span className="text-[10px] text-slate-400 block leading-tight">Yield</span>
          <span className="text-base font-extrabold font-mono text-emerald-600">{generatedYieldPercent.toFixed(1)}%</span>
        </div>

        {/* Hoy */}
        <div className="bg-white p-3 rounded-xl border border-slate-200">
          <span className="text-[10px] text-slate-400 block leading-tight">Hoy</span>
          <div className="flex items-center gap-3 mt-1">
            <span className="text-[11px] font-semibold font-mono text-slate-500">IPSA</span>
            <span className={`text-sm font-extrabold font-mono ${ipsaDailyChange !== null && ipsaDailyChange >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
              {ipsaDailyChange !== null ? `${ipsaDailyChange >= 0 ? '+' : ''}${ipsaDailyChange.toFixed(2)}%` : ipsaLoading ? '...' : '—'}
            </span>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-[11px] font-semibold font-mono text-slate-500">Cartera</span>
            <span className={`text-sm font-extrabold font-mono ${dailyPnL >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
              {portfolioOpenValue > 0 ? `${dailyPnL >= 0 ? '+' : ''}${((dailyPnL / portfolioOpenValue) * 100).toFixed(2)}%` : '—'}
            </span>
            {ipsaDailyChange !== null && portfolioOpenValue > 0 && (() => {
              const pfPct = (dailyPnL / portfolioOpenValue) * 100;
              if (pfPct > ipsaDailyChange) return <span className="text-[10px] text-emerald-500 font-bold">▲</span>;
              if (pfPct < ipsaDailyChange) return <span className="text-[10px] text-rose-500 font-bold">▼</span>;
              return <span className="text-[10px] text-slate-400">—</span>;
            })()}
          </div>
        </div>

        {/* Este Mes */}
        <div className="bg-white p-3 rounded-xl border border-slate-200">
          <span className="text-[10px] text-slate-400 block leading-tight">Este Mes</span>
          <div className="flex items-center gap-3 mt-1">
            <span className="text-[11px] font-semibold font-mono text-slate-500">IPSA</span>
            <span className={`text-sm font-extrabold font-mono ${monthlyChange.ipsaPct !== null && monthlyChange.ipsaPct >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
              {monthlyChange.hasMonthly ? `${monthlyChange.ipsaPct! >= 0 ? '+' : ''}${monthlyChange.ipsaPct!.toFixed(2)}%` : ipsaLoading ? '...' : '—'}
            </span>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-[11px] font-semibold font-mono text-slate-500">Cartera</span>
            <span className={`text-sm font-extrabold font-mono ${monthlyChange.pfPct !== null && monthlyChange.pfPct >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
              {monthlyChange.pfPct !== null ? `${monthlyChange.pfPct >= 0 ? '+' : ''}${monthlyChange.pfPct.toFixed(2)}%` : '—'}
            </span>
            {monthlyChange.pfPct !== null && monthlyChange.ipsaPct !== null && (() => {
              if (monthlyChange.pfPct! > monthlyChange.ipsaPct!) return <span className="text-[10px] text-emerald-500 font-bold">▲</span>;
              if (monthlyChange.pfPct! < monthlyChange.ipsaPct!) return <span className="text-[10px] text-rose-500 font-bold">▼</span>;
              return <span className="text-[10px] text-slate-400">—</span>;
            })()}
          </div>
        </div>

        {/* Desde Inicio */}
        <div className="bg-white p-3 rounded-xl border border-slate-200">
          <span className="text-[10px] text-slate-400 block leading-tight">Desde Inicio</span>
          <div className="flex items-center gap-3 mt-1">
            <span className="text-[11px] font-semibold font-mono text-slate-500">IPSA</span>
            <span className={`text-sm font-extrabold font-mono ${ipsaSinceInicio !== null && ipsaSinceInicio >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
              {ipsaSinceInicio !== null ? `${ipsaSinceInicio >= 0 ? '+' : ''}${ipsaSinceInicio.toFixed(2)}%` : ipsaLoading ? '...' : '—'}
            </span>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-[11px] font-semibold font-mono text-slate-500">Cartera</span>
            <span className={`text-sm font-extrabold font-mono ${totalReturnPct !== null && totalReturnPct >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
              {totalReturnPct !== null ? `${totalReturnPct >= 0 ? '+' : ''}${totalReturnPct.toFixed(2)}%` : '—'}
            </span>
            {totalReturnPct !== null && ipsaSinceInicio !== null && (() => {
              if (totalReturnPct > ipsaSinceInicio) return <span className="text-[10px] text-emerald-500 font-bold">▲</span>;
              if (totalReturnPct < ipsaSinceInicio) return <span className="text-[10px] text-rose-500 font-bold">▼</span>;
              return <span className="text-[10px] text-slate-400">—</span>;
            })()}
          </div>
        </div>
      </div>

      {/* Gráfico Intradiario (Hoy) */}
      {renderIntradayChart() !== null && (
        <div className="bg-white p-4 rounded-xl border border-slate-200">
          <div className="flex items-center space-x-1.5 mb-2">
            <BarChart3 className="w-3.5 h-3.5 text-amber-500" />
            <span className="font-bold text-slate-800 text-xs">Hoy (Intradiario)</span>
          </div>
          {renderIntradayChart()}
        </div>
      )}

      {/* Gráfico de área + Minusvalía/Plusvalía */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
        <div className="md:col-span-3 bg-white p-4 rounded-xl border border-slate-200">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center space-x-1.5">
              <TrendingUp className="w-3.5 h-3.5 text-indigo-500" />
              <span className="font-bold text-slate-800 text-xs">Evolución del Portafolio</span>
            </div>
            <div className="flex gap-1">
              {(['week', 'month', 'year'] as ChartRange[]).map(r => (
                <button key={r} onClick={() => setChartRange(r)}
                  className={`px-2 py-1 text-[10px] font-bold rounded-md transition cursor-pointer ${
                    chartRange === r ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'
                  }`}>
                  {r === 'week' ? 'Semana' : r === 'month' ? 'Mes' : 'Año'}
                </button>
              ))}
            </div>
          </div>
          {renderAreaChart()}
        </div>

        {/* Minusvalía / Plusvalía */}
        <div className="flex flex-col gap-2">
          <div className="bg-rose-50 border border-rose-100 p-3 rounded-xl flex-1">
            <span className="text-[9px] text-rose-500 uppercase font-bold tracking-wider">Minusvalía</span>
            <span className="text-xs font-bold text-rose-700 font-mono block mt-0.5">-{formatCLP(totalLosses)}</span>
            <span className="text-[9px] text-rose-400">{holdingsWithLosses.length} activas</span>
          </div>
          <div className="bg-emerald-50 border border-emerald-100 p-3 rounded-xl flex-1">
            <span className="text-[9px] text-emerald-500 uppercase font-bold tracking-wider">Plusvalía</span>
            <span className="text-xs font-bold text-emerald-700 font-mono block mt-0.5">+{formatCLP(totalGains)}</span>
            <span className="text-[9px] text-emerald-400">{holdingsWithGains.length} activas</span>
          </div>
          <div className={`p-3 rounded-xl border flex-1 ${isNetGain ? 'bg-emerald-50 border-emerald-200' : 'bg-rose-50 border-rose-200'}`}>
            <span className="text-[9px] uppercase font-bold tracking-wider text-slate-500">Neto</span>
            <span className={`text-xs font-bold font-mono block mt-0.5 ${isNetGain ? 'text-emerald-700' : 'text-rose-700'}`}>
              {isNetGain ? '+' : ''}{formatCLP(netCapitalGainOrLoss)}
            </span>
            <span className={`text-[9px] font-mono ${isNetGain ? 'text-emerald-400' : 'text-rose-400'}`}>
              ({((netCapitalGainOrLoss / (computedContributed || 1)) * 100).toFixed(1)}%)
            </span>
          </div>
        </div>
      </div>

      {/* Análisis de Concentración */}
      {sectorAllocation.length > 0 && (
        <div className="bg-white p-4 rounded-xl border border-slate-200">
          <div className="flex items-center space-x-1.5 mb-3">
            <PieChart className="w-3.5 h-3.5 text-indigo-500" />
            <h4 className="font-bold text-slate-800 text-xs">Concentración por Sector</h4>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="flex items-center justify-center">
              <div className="relative w-32 h-32">
                <svg viewBox="0 0 36 36" className="w-full h-full -rotate-90">
                  {sectorAllocation.map((s, i) => {
                    const colors = ['#6366f1','#14b8a6','#f59e0b','#ef4444','#8b5cf6','#ec4899','#06b6d4','#84cc16','#f97316','#64748b'];
                    const totalPct = sectorAllocation.slice(0, i).reduce((a, x) => a + x.percentage, 0);
                    const circumference = 100;
                    const offset = 100 - totalPct;
                    const length = s.percentage;
                    return (
                      <circle key={s.sector} cx="18" cy="18" r="15.915"
                        fill="none" stroke={colors[i % colors.length]} strokeWidth="3"
                        strokeDasharray={`${length} ${circumference - length}`}
                        strokeDashoffset={offset} />
                    );
                  })}
                  <circle cx="18" cy="18" r="15.915" fill="none" stroke="#e2e8f0" strokeWidth="3"
                    strokeDasharray={`${100 - sectorAllocation.reduce((a, s) => a + s.percentage, 0)} 100`}
                    strokeDashoffset={sectorAllocation.reduce((a, s) => a + s.percentage, 0)} />
                </svg>
                <div className="absolute inset-0 flex items-center justify-center">
                  <div className="text-center">
                    <span className="block text-sm font-extrabold font-mono text-slate-800">{sectorAllocation.length}</span>
                    <span className="block text-[8px] text-slate-400 uppercase tracking-wider">Sectores</span>
          </div>
        </div>
      </div>
            </div>
            <div className="space-y-2">
              {sectorAllocation.sort((a, b) => b.percentage - a.percentage).map((s, i) => {
                const colors = ['bg-indigo-500','bg-teal-500','bg-amber-500','bg-rose-500','bg-purple-500','bg-pink-500','bg-cyan-500','bg-lime-500','bg-orange-500','bg-slate-400'];
                const isConcentrated = s.percentage > 30;
                return (
                  <div key={s.sector}>
                    <div className="flex items-center justify-between text-[10px] mb-0.5">
                      <div className="flex items-center gap-1">
                        <span className={`w-2 h-2 rounded-full ${colors[i % colors.length]}`} />
                        <span className="font-semibold text-slate-700">{s.sector}</span>
                        {isConcentrated && <AlertTriangle className="w-3 h-3 text-amber-500" />}
                      </div>
                      <span className={`font-mono font-bold ${isConcentrated ? 'text-amber-600' : 'text-slate-600'}`}>
                        {s.percentage.toFixed(1)}%
                      </span>
                    </div>
                    <div className="w-full bg-slate-100 rounded-full h-1.5 overflow-hidden">
                      <div className={`h-full rounded-full transition-all duration-700 ease-out ${isConcentrated ? 'bg-amber-400' : colors[i % colors.length]}`}
                        style={{ width: `${s.percentage}%` }} />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
          {sectorAllocation.some(s => s.percentage > 30) && (
            <div className="mt-3 p-2.5 bg-amber-50 border border-amber-200 rounded-lg text-[10px] text-amber-800 flex items-start gap-2">
              <AlertTriangle className="w-3.5 h-3.5 text-amber-500 shrink-0 mt-0.5" />
              <span>{sectorAllocation.filter(s => s.percentage > 30).map(s => s.sector).join(', ')} supera el 30%. Considera diversificar.</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
