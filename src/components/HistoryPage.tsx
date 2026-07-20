import React, { useState, useEffect, useRef } from 'react';
import { StockHolding, DividendPayment } from '../types';
import type { IntradayPoint } from '../lib/intradaySnapshot';
import { supabaseService } from '../lib/supabaseService';
import { formatCLP } from '../utils';
import { HelpCircle, BarChart3, CalendarDays } from 'lucide-react';
import ProfitHistory from './ProfitHistory';
import DividendHistory from './DividendHistory';

interface HistoryPageProps {
  holdings: StockHolding[];
  dividends: DividendPayment[];
  todayPnL?: number;
  hasDataFromToday?: boolean;
}

type SubTab = 'pnl' | 'dividends' | 'intraday';

function getDateStr(d: Date): string {
  return d.toLocaleDateString('en-CA', { timeZone: 'America/Santiago' });
}

function renderIntradayChart(data: IntradayPoint[], dateLabel: string) {
  if (data.length < 1) return (
    <div className="flex items-center justify-center h-24 text-[9px] text-slate-400">Sin datos intradiarios para esta fecha</div>
  );
  const openVal = data[0].portfolioValue;
  const lastVal = data[data.length - 1].portfolioValue;
  const pnl = lastVal - openVal;
  const pnlPct = openVal > 0 ? (pnl / openVal) * 100 : 0;

  if (data.length < 2) {
    return (
      <div>
        <div className="flex items-baseline gap-3 mb-1">
          <span className={`text-base font-extrabold font-mono ${pnl >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
            {pnl >= 0 ? '+' : ''}{formatCLP(pnl)}
          </span>
          <span className="text-[9px] text-slate-400">1 punto — datos insuficientes</span>
        </div>
        <div className="flex items-center justify-center h-12 text-[9px] text-slate-300">completando datos del día...</div>
      </div>
    );
  }

  const pnlValues = data.map(d => d.portfolioValue - openVal);
  const maxPnl = Math.max(...pnlValues, 1);
  const minPnl = Math.min(...pnlValues, -1);
  const range = Math.max(maxPnl - minPnl, 1);

  const vbW = 700;
  const vbH = 100;
  const padT = 8;
  const padB = 16;
  const chartW = vbW;
  const chartH = vbH - padT - padB;
  const stepX = chartW / (data.length - 1);
  const zeroY = padT + chartH - ((0 - minPnl) / range) * chartH;

  const points = pnlValues.map((v, i) => ({
    x: i * stepX,
    y: padT + chartH - ((v - minPnl) / range) * chartH,
  }));
  const linePath = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
  const areaPath = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ') +
    ` L${points[points.length - 1].x},${padT + chartH} L${points[0].x},${padT + chartH} Z`;

  const labelStep = Math.max(1, Math.floor(data.length / 6));

  const HoverChart = () => {
    const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);
    return (
      <div>
        <svg viewBox={`0 0 ${vbW} ${vbH}`} style={{ width: '100%', aspectRatio: `${vbW}/${vbH}`, display: 'block' }}
          onMouseMove={(e) => {
            const rect = e.currentTarget.getBoundingClientRect();
            const frac = (e.clientX - rect.left) / rect.width;
            let idx = Math.round(frac * (data.length - 1));
            idx = Math.max(0, Math.min(data.length - 1, idx));
            setHoveredIdx(idx);
          }}
          onMouseLeave={() => setHoveredIdx(null)}>
          <defs>
            <linearGradient id="histIntradayGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={pnl >= 0 ? '#14b8a6' : '#ef4444'} stopOpacity="0.25" />
              <stop offset="100%" stopColor={pnl >= 0 ? '#14b8a6' : '#ef4444'} stopOpacity="0.02" />
            </linearGradient>
          </defs>
          <line x1={0} y1={zeroY} x2={vbW} y2={zeroY} stroke="#cbd5e1" strokeWidth="0.5" strokeDasharray="3 3" />
          <path d={areaPath} fill="url(#histIntradayGrad)" />
          <path d={linePath} fill="none" stroke={pnl >= 0 ? '#14b8a6' : '#ef4444'} strokeWidth="2.5" />
          {points.map((p, idx) => {
            if (idx % labelStep !== 0 && idx !== points.length - 1) return null;
            return <circle key={idx} cx={p.x} cy={p.y} r="2" fill={pnl >= 0 ? '#14b8a6' : '#ef4444'} />;
          })}
          {hoveredIdx !== null && points[hoveredIdx] && (
            <g>
              <line x1={points[hoveredIdx].x} y1={padT} x2={points[hoveredIdx].x} y2={padT + chartH} stroke="#94a3b8" strokeWidth="1" strokeDasharray="2 2" />
              <circle cx={points[hoveredIdx].x} cy={points[hoveredIdx].y} r="5" fill="#0f172a" stroke={pnl >= 0 ? '#2dd4bf' : '#fb7185'} strokeWidth="2" />
            </g>
          )}
        </svg>
        <div className="h-5 mt-0.5 flex items-center justify-center">
          {hoveredIdx !== null && data[hoveredIdx] ? (
            (() => {
              const d = data[hoveredIdx];
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
    <div>
      <div className="flex items-baseline gap-3 mb-1">
        <span className={`text-base font-extrabold font-mono ${pnl >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
          {pnl >= 0 ? '+' : ''}{formatCLP(pnl)}
        </span>
        <span className={`text-sm font-bold font-mono ${pnl >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
          ({pnlPct >= 0 ? '+' : ''}{pnlPct.toFixed(2)}%)
        </span>
        <span className="text-xs text-slate-400">{dateLabel}, {data.length}pts</span>
      </div>
      <HoverChart />
    </div>
  );
}

export default function HistoryPage({ holdings, dividends, todayPnL, hasDataFromToday }: HistoryPageProps) {
  const [subTab, setSubTab] = useState<SubTab>('pnl');
  const [selectedDate, setSelectedDate] = useState(() => getDateStr(new Date()));
  const [intradayHistory, setIntradayHistory] = useState<IntradayPoint[]>([]);
  const [loadingIntraday, setLoadingIntraday] = useState(false);

  useEffect(() => {
    setLoadingIntraday(true);
    supabaseService.pullIntradaySnapshots(selectedDate)
      .then(data => setIntradayHistory(data || []))
      .catch(() => setIntradayHistory([]))
      .finally(() => setLoadingIntraday(false));
  }, [selectedDate]);

  const todayStr = getDateStr(new Date());
  const dateLabel = selectedDate === todayStr ? 'hoy' : selectedDate;

  return (
    <div className="space-y-4">
      {/* Sub-tabs */}
      <div className="flex items-center gap-1 bg-white rounded-xl border border-slate-200 p-1 shadow-sm">
        <button
          onClick={() => setSubTab('pnl')}
          className={`flex-1 px-4 py-2 text-xs font-bold rounded-lg transition cursor-pointer ${
            subTab === 'pnl'
              ? 'bg-slate-900 text-white shadow-sm'
              : 'text-slate-500 hover:text-slate-900 hover:bg-slate-100'
          }`}
        >
          Ganancias y Pérdidas
        </button>
        <button
          onClick={() => setSubTab('intraday')}
          className={`flex-1 px-4 py-2 text-xs font-bold rounded-lg transition cursor-pointer ${
            subTab === 'intraday'
              ? 'bg-slate-900 text-white shadow-sm'
              : 'text-slate-500 hover:text-slate-900 hover:bg-slate-100'
          }`}
        >
          Intradiario
        </button>
        <button
          onClick={() => setSubTab('dividends')}
          className={`flex-1 px-4 py-2 text-xs font-bold rounded-lg transition cursor-pointer ${
            subTab === 'dividends'
              ? 'bg-slate-900 text-white shadow-sm'
              : 'text-slate-500 hover:text-slate-900 hover:bg-slate-100'
          }`}
        >
          Dividendos
        </button>
      </div>

      {/* Content */}
      {subTab === 'pnl' ? (
        <ProfitHistory holdings={holdings} todayPnL={todayPnL} hasDataFromToday={hasDataFromToday} />
      ) : subTab === 'intraday' ? (
        <div className="bg-white p-4 rounded-xl border border-slate-200">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center space-x-1.5">
              <BarChart3 className="w-3.5 h-3.5 text-amber-500" />
              <span className="font-bold text-slate-800 text-xs">Intradiario por Fecha</span>
            </div>
            <div className="flex items-center gap-2">
              <CalendarDays className="w-3.5 h-3.5 text-slate-400" />
              <input
                type="date"
                value={selectedDate}
                max={todayStr}
                onChange={(e) => setSelectedDate(e.target.value)}
                className="text-[11px] font-mono border border-slate-200 rounded-lg px-2 py-1 bg-slate-50 text-slate-700 focus:outline-none focus:ring-2 focus:ring-amber-300"
              />
            </div>
          </div>
          {loadingIntraday ? (
            <div className="flex items-center justify-center h-24 text-xs text-slate-400">Cargando...</div>
          ) : (
            renderIntradayChart(intradayHistory, dateLabel)
          )}
        </div>
      ) : (
        <DividendHistory dividends={dividends} />
      )}
    </div>
  );
}
