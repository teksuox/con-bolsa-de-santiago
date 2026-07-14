import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { StockHolding } from '../types';
import { formatCLP } from '../utils';
import { supabaseService } from '../lib/supabaseService';
import { PlusCircle, X, AlertCircle, ArrowRight, ArrowUpDown, TrendingUp } from 'lucide-react';

interface Allocation {
  ticker: string;
  name: string;
  percent: number;
  inPlan: boolean;
  brokerPrice?: number;
  amount?: number;
}

interface InvestmentPlanProps {
  marketStocks: { ticker: string; name: string; price: number; dividendYield: number }[];
  holdings: StockHolding[];
  refreshKey?: number;
}

export default function InvestmentPlan({ marketStocks, holdings, refreshKey }: InvestmentPlanProps) {
  const [budget, setBudget] = useState<number>(1000000);
  const [allocations, setAllocations] = useState<Allocation[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [overrideCapital, setOverrideCapital] = useState(false);
  const [overrideCapitalValue, setOverrideCapitalValue] = useState('');
  const [monthlyStr, setMonthlyStr] = useState('300.000');
  const [increaseStr, setIncreaseStr] = useState('20.000');
  const [yearsStr, setYearsStr] = useState('25');
  const [targetMonthlyStr, setTargetMonthlyStr] = useState('2.000.000');
  const [incluyeCredito, setIncluyeCredito] = useState(false);
  const [seguirAportando, setSeguirAportando] = useState(true);
  const [planTab, setPlanTab] = useState<'asignacion' | 'proyeccion'>('asignacion');

  // Tramos Global Complementario AT 2026 (LIR Art. 52)
  const TAX_BRACKETS = useMemo(() => [
    { limit: 11265804, rate: 0, rebate: 0 },
    { limit: 25035120, rate: 0.04, rebate: 450632 },
    { limit: 41725200, rate: 0.08, rebate: 1452037 },
    { limit: 58415280, rate: 0.135, rebate: 3746923 },
    { limit: 75105360, rate: 0.23, rebate: 9296375 },
    { limit: 100140480, rate: 0.304, rebate: 14854171 },
    { limit: 258696240, rate: 0.35, rebate: 19460633 },
    { limit: Infinity, rate: 0.40, rebate: 32395445 },
  ], []);
  const calcTax = useCallback((income: number) => {
    for (const b of TAX_BRACKETS) {
      if (income <= b.limit) {
        return Math.round(income * b.rate - b.rebate);
      }
    }
    return 0;
  }, [TAX_BRACKETS]);

  const formatNum = (n: number) => Math.round(n).toLocaleString('es-CL');
  const cleanNum = (s: string) => parseInt(s.replace(/\./g, ''), 10) || 0;

  const portfolioValue = useMemo(() =>
    holdings.reduce((sum, h) => sum + h.shares * h.currentPrice, 0),
  [holdings]);

  const totalCost = useMemo(() =>
    holdings.reduce((sum, h) => sum + h.shares * h.buyPrice, 0),
  [holdings]);

  const projCapital = overrideCapital ? (cleanNum(overrideCapitalValue) || totalCost) : totalCost;
  const projMonthly = cleanNum(monthlyStr);
  const projIncrease = cleanNum(increaseStr);

  // Calculate weighted yield from portfolio mix
  const portfolioMix: { ticker: string; pct: number }[] = [
    { ticker: 'ANDINA-B', pct: 20 },
    { ticker: 'CHILE', pct: 20 },
    { ticker: 'QUINENCO', pct: 10 },
    { ticker: 'ENELCHILE', pct: 10 },
    { ticker: 'PEHUENCHE', pct: 10 },
    { ticker: 'CFMITNIPSA', pct: 10 },
    { ticker: 'ZOFRI', pct: 10 },
    { ticker: 'HABITAT', pct: 10 },
  ];
  const weightedYield = useMemo(() => {
    let totalPct = 0;
    let weighted = 0;
    for (const m of portfolioMix) {
      const stock = marketStocks.find(s => s.ticker === m.ticker);
      if (stock && stock.dividendYield > 0) {
        weighted += m.pct * stock.dividendYield;
        totalPct += m.pct;
      }
    }
    return totalPct > 0 ? weighted / totalPct / 100 : 0.07;
  }, [marketStocks]);

  useEffect(() => {
    // Load from localStorage fallback first
    try {
      const saved = localStorage.getItem('investment_plan_backup');
      if (saved) {
        const p = JSON.parse(saved);
        if (p.budget != null) setBudget(p.budget);
        if (Array.isArray(p.allocations)) setAllocations(p.allocations);
      }
    } catch {}
    supabaseService.pullInvestmentPlan().then(plan => {
      if (plan) {
        setBudget(plan.budget ?? 1000000);
        setAllocations(plan.allocations ?? []);
      }
      setLoaded(true);
    }).catch(() => {
      console.warn('[InvestmentPlan] Error loading plan');
      setLoaded(true);
    });
  }, [refreshKey]);

  // Persist to Supabase when data changes (skip initial mount)
  const lastSyncKeyRef = useRef('');
  const isFirstRender = useRef(true);
  useEffect(() => {
    if (!loaded) return;
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }
    const key = JSON.stringify({ budget, allocations });
    if (key === lastSyncKeyRef.current) return;
    lastSyncKeyRef.current = key;
    supabaseService.syncInvestmentPlan({ budget, allocations }).catch(() => {});
    try { localStorage.setItem('investment_plan_backup', JSON.stringify({ budget, allocations })); } catch {}
  }, [budget, allocations, loaded]);

  const [selectedTicker, setSelectedTicker] = useState('');
  const [customTicker, setCustomTicker] = useState('');
  const [customName, setCustomName] = useState('');
  const [percent, setPercent] = useState<number | ''>(10);
  const [formAmount, setFormAmount] = useState<number | ''>('');
  const [formPrice, setFormPrice] = useState<number | ''>('');
  const [inPlan, setInPlan] = useState(true);
  const [isCustom, setIsCustom] = useState(false);
  const [formOpen, setFormOpen] = useState(false);

  const getPrice = (ticker: string): number => {
    const s = marketStocks.find(m => m.ticker === ticker);
    return s?.price || 0;
  };

  const effectivePrice = (a: Allocation): number => a.brokerPrice ?? getPrice(a.ticker);
  const amountFor = (a: Allocation): number => a.inPlan ? budget * a.percent / 100 : (a.amount ?? 0);
  const sharesFor = (a: Allocation): number => {
    const ep = effectivePrice(a);
    const amt = amountFor(a);
    return ep > 0 && amt > 0 ? Math.floor(amt / ep) : 0;
  };

  const planItems = allocations.filter(a => a.inPlan);
  const outsideItems = allocations.filter(a => !a.inPlan);

  const totalPercent = planItems.reduce((s, a) => s + a.percent, 0);
  const totalAllocated = planItems.reduce((s, a) => s + (budget * a.percent / 100), 0);
  const totalOutside = outsideItems.reduce((s, a) => s + amountFor(a), 0);
  const remainingBudget = budget - totalAllocated;
  const overBudget = totalPercent > 100;

  type SortDir = 'asc' | 'desc';
  const [planSort, setPlanSort] = useState<{ key: string; dir: SortDir } | null>(null);
  const [outSort, setOutSort] = useState<{ key: string; dir: SortDir } | null>(null);

  const togglePlanSort = (key: string) => {
    setPlanSort(prev => prev?.key === key ? { key, dir: prev.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' });
  };
  const toggleOutSort = (key: string) => {
    setOutSort(prev => prev?.key === key ? { key, dir: prev.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' });
  };

  const sortItems = (items: Allocation[], sort: { key: string; dir: SortDir } | null): Allocation[] => {
    if (!sort) return items;
    return [...items].sort((a, b) => {
      let aVal: any, bVal: any;
      switch (sort.key) {
        case 'ticker': aVal = a.ticker; bVal = b.ticker; break;
        case 'name': aVal = a.name; bVal = b.name; break;
        case 'percent': aVal = a.percent; bVal = b.percent; break;
        case 'price': aVal = effectivePrice(a); bVal = effectivePrice(b); break;
        case 'amount': aVal = amountFor(a); bVal = amountFor(b); break;
        case 'shares': aVal = sharesFor(a); bVal = sharesFor(b); break;
        default: return 0;
      }
      if (typeof aVal === 'string') aVal = aVal.toLowerCase();
      if (typeof bVal === 'string') bVal = bVal.toLowerCase();
      if (aVal < bVal) return sort.dir === 'asc' ? -1 : 1;
      if (aVal > bVal) return sort.dir === 'asc' ? 1 : -1;
      return 0;
    });
  };

  const sortedPlanItems = sortItems(planItems, planSort);
  const sortedOutsideItems = sortItems(outsideItems, outSort);

  const sortIcon = (currentKey: string, sort: { key: string; dir: SortDir } | null) => {
    if (sort?.key !== currentKey) return <ArrowUpDown className="w-3 h-3 inline ml-1 opacity-30" />;
    return sort.dir === 'asc' ? ' ↑' : ' ↓';
  };

  const addAllocation = () => {
    const ticker = isCustom ? customTicker.toUpperCase().trim() : selectedTicker;
    const name = isCustom ? customName : (marketStocks.find(s => s.ticker === ticker)?.name || ticker);
    if (!ticker) return alert('Selecciona o ingresa un ticker');
    if (inPlan && (!percent || Number(percent) <= 0)) return alert('Ingresa un porcentaje válido');
    if (!inPlan && (!formAmount || Number(formAmount) <= 0)) return alert('Ingresa un monto válido');
    if (allocations.some(a => a.ticker === ticker)) return alert('Esa acción ya está agregada');
    const bp = formPrice !== '' && Number(formPrice) > 0 ? Number(formPrice) : undefined;
    setAllocations(prev => [...prev, {
      ticker, name,
      percent: inPlan ? Number(percent) : 0,
      inPlan,
      brokerPrice: bp,
      amount: !inPlan ? Number(formAmount) : undefined
    }]);
    setCustomTicker('');
    setCustomName('');
    setPercent(10);
    setFormAmount('');
    setFormPrice('');
    setInPlan(true);
    setFormOpen(false);
  };

  const removeAllocation = (ticker: string) => {
    setAllocations(prev => prev.filter(a => a.ticker !== ticker));
  };

  const updatePercent = (ticker: string, newPercent: number) => {
    setAllocations(prev => prev.map(a => a.ticker === ticker ? { ...a, percent: newPercent } : a));
  };

  const updateBrokerPrice = (ticker: string, price: number) => {
    setAllocations(prev => prev.map(a => a.ticker === ticker ? { ...a, brokerPrice: price > 0 ? price : undefined } : a));
  };

  const updateAmount = (ticker: string, amount: number) => {
    setAllocations(prev => prev.map(a => a.ticker === ticker ? { ...a, amount: amount > 0 ? amount : undefined } : a));
  };

  const moveToPlan = (ticker: string) => {
    setAllocations(prev => prev.map(a => {
      if (a.ticker !== ticker) return a;
      const amt = amountFor(a);
      const newPercent = budget > 0 && amt > 0 ? Math.round((amt / budget) * 100 * 10) / 10 : 5;
      return { ...a, inPlan: true, percent: newPercent, amount: undefined };
    }));
  };

  const moveOutside = (ticker: string) => {
    setAllocations(prev => prev.map(a => {
      if (a.ticker !== ticker) return a;
      const amt = amountFor(a);
      return { ...a, inPlan: false, percent: 0, amount: amt > 0 ? amt : undefined };
    }));
  };

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-xl border border-slate-200 p-6">
        <h2 className="text-lg font-bold text-slate-900 mb-4">Plan de Inversión</h2>

        {/* Sub-tabs */}
        <div className="flex gap-1 mb-5 bg-slate-100 rounded-lg p-1 w-fit">
          <button
            onClick={() => setPlanTab('asignacion')}
            className={`px-4 py-1.5 text-xs font-medium rounded-md transition ${
              planTab === 'asignacion' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'
            }`}
          >
            Asignación
          </button>
          <button
            onClick={() => setPlanTab('proyeccion')}
            className={`px-4 py-1.5 text-xs font-medium rounded-md transition ${
              planTab === 'proyeccion' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'
            }`}
          >
            Proyección
          </button>
        </div>

        {planTab === 'asignacion' && (
        <>
        {/* Budget Input */}
        <div className="mb-6">
          <label className="block text-xs font-medium text-slate-600 mb-1">Presupuesto Total (CLP)</label>
          <input
            type="number"
            value={budget}
            onChange={(e) => setBudget(Number(e.target.value))}
            className="w-full max-w-xs text-sm border border-slate-200 rounded-lg p-2.5 bg-white focus:outline-none focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500 font-mono"
          />
        </div>

        {/* Summary Cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
          <div className="bg-slate-50 p-4 rounded-lg border border-slate-200">
            <span className="text-xs text-slate-500 uppercase tracking-wider font-medium">Presupuesto</span>
            <span className="text-xl font-bold font-mono text-slate-900 block mt-1">{formatCLP(budget)}</span>
          </div>
          <div className="bg-slate-50 p-4 rounded-lg border border-slate-200">
            <span className="text-xs text-slate-500 uppercase tracking-wider font-medium">Asignado al Plan</span>
            <span className={`text-xl font-bold font-mono block mt-1 ${totalPercent > 100 ? 'text-rose-600' : 'text-teal-600'}`}>
              {formatCLP(totalAllocated)}
            </span>
            <span className="text-xs text-slate-400 block">{totalPercent.toFixed(1)}% del presupuesto</span>
          </div>
          <div className="bg-slate-50 p-4 rounded-lg border border-slate-200">
            <span className="text-xs text-slate-500 uppercase tracking-wider font-medium">Fuera del Plan</span>
            <span className="text-xl font-bold font-mono text-slate-700 block mt-1">{formatCLP(totalOutside)}</span>
            <span className="text-xs text-slate-400 block">{outsideItems.length} acción{outsideItems.length !== 1 ? 'es' : ''}</span>
          </div>
        </div>

        {overBudget && (
          <div className="flex items-center gap-2 p-3 bg-rose-50 border border-rose-200 rounded-lg mb-4 text-sm text-rose-700">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>La suma de porcentajes supera el 100%. Ajusta los porcentajes o mueve acciones fuera del plan.</span>
          </div>
        )}

        {/* Add Allocation Button */}
        <button
          onClick={() => setFormOpen(!formOpen)}
          className="flex items-center space-x-1.5 bg-slate-900 hover:bg-slate-800 text-white text-xs font-medium px-4 py-2 rounded-lg transition mb-4"
        >
          <PlusCircle className="w-4 h-4" />
          <span>Agregar Acción</span>
        </button>

        {/* Add Form */}
        {formOpen && (
          <div className="p-4 bg-slate-50 rounded-lg border border-slate-200 mb-4 space-y-3">
            <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Acción</label>
                <select
                  value={isCustom ? 'CUSTOM' : selectedTicker}
                  onChange={(e) => {
                    if (e.target.value === 'CUSTOM') { setIsCustom(true); setSelectedTicker(''); }
                    else { setIsCustom(false); setSelectedTicker(e.target.value); }
                  }}
                  className="w-full text-xs border border-slate-200 rounded-lg p-2 bg-white"
                >
                  <option value="">Seleccionar...</option>
                  {[...marketStocks].sort((a, b) => a.ticker.localeCompare(b.ticker)).map(s => (
                    <option key={s.ticker} value={s.ticker}>{s.ticker} - {s.name}</option>
                  ))}
                  <option value="CUSTOM">OTRA (Personalizado)</option>
                </select>
              </div>
              {isCustom && (
                <>
                  <div>
                    <label className="block text-xs font-medium text-slate-600 mb-1">Ticker</label>
                    <input type="text" value={customTicker} onChange={(e) => setCustomTicker(e.target.value.toUpperCase())} placeholder="Ej: COLBUN" className="w-full text-xs border border-slate-200 rounded-lg p-2 bg-white" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-600 mb-1">Nombre</label>
                    <input type="text" value={customName} onChange={(e) => setCustomName(e.target.value)} placeholder="Ej: Colbún S.A." className="w-full text-xs border border-slate-200 rounded-lg p-2 bg-white" />
                  </div>
                </>
              )}
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Tipo</label>
                <select
                  value={inPlan ? 'plan' : 'outside'}
                  onChange={(e) => setInPlan(e.target.value === 'plan')}
                  className="w-full text-xs border border-slate-200 rounded-lg p-2 bg-white"
                >
                  <option value="plan">En el Plan</option>
                  <option value="outside">Fuera del Plan</option>
                </select>
              </div>
              {inPlan ? (
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Porcentaje (%)</label>
                  <input
                    type="number" step="0.1" min="0.1" max="100"
                    value={percent} onChange={(e) => setPercent(e.target.value === '' ? '' : Number(e.target.value))}
                    className="w-full text-xs border border-slate-200 rounded-lg p-2 bg-white"
                  />
                </div>
              ) : (
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Monto a invertir (CLP)</label>
                  <input
                    type="number" min="1"
                    value={formAmount} onChange={(e) => setFormAmount(e.target.value === '' ? '' : Number(e.target.value))}
                    className="w-full text-xs border border-slate-200 rounded-lg p-2 bg-white font-mono"
                  />
                </div>
              )}
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Precio broker (opcional)</label>
                <input
                  type="number" step="0.01" min="0"
                  value={formPrice} onChange={(e) => setFormPrice(e.target.value === '' ? '' : Number(e.target.value))}
                  placeholder={(() => {
                    const ticker = isCustom ? customTicker.toUpperCase().trim() : selectedTicker;
                    if (!ticker) return 'Automático';
                    const p = getPrice(ticker);
                    return p > 0 ? `Auto: ${formatCLP(p, true)}` : 'Automático';
                  })()}
                  className="w-full text-xs border border-slate-200 rounded-lg p-2 bg-white font-mono"
                />
              </div>
              <div className="flex items-end">
                <button onClick={addAllocation} className="bg-teal-600 hover:bg-teal-500 text-white text-xs font-semibold px-4 py-2 rounded-lg transition w-full">
                  Agregar
                </button>
              </div>
            </div>
          </div>
        )}

        {allocations.length === 0 && (
          <div className="text-center py-8 text-slate-400 text-sm">
            <p>No has agregado acciones.</p>
            <p className="text-xs mt-1">Define tu presupuesto y agrega las acciones indicando si entran en el plan o quedan fuera.</p>
          </div>
        )}

        {/* Two Grids */}
        {allocations.length > 0 && (
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
            {/* Plan Grid */}
            <div>
              <h3 className="text-sm font-semibold text-teal-700 bg-teal-50 px-3 py-2 rounded-lg mb-3 flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-teal-500"></span>
                En el Plan ({sortedPlanItems.length})
              </h3>
              {sortedPlanItems.length === 0 ? (
                <div className="text-center py-6 text-slate-400 text-xs border border-dashed border-slate-200 rounded-lg">
                  Sin acciones en el plan
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs border-collapse">
                    <thead>
                      <tr className="border-b border-slate-200 bg-slate-50/70 text-[11px] font-semibold text-slate-500 uppercase tracking-wider">
                        <th className="py-2.5 px-2 cursor-pointer select-none hover:text-slate-800" onClick={() => togglePlanSort('ticker')}>Acción{sortIcon('ticker', planSort)}</th>
                        <th className="py-2.5 px-2 text-right cursor-pointer select-none hover:text-slate-800" onClick={() => togglePlanSort('percent')}>%{sortIcon('percent', planSort)}</th>
                        <th className="py-2.5 px-2 text-right cursor-pointer select-none hover:text-slate-800" onClick={() => togglePlanSort('price')}>Precio{sortIcon('price', planSort)}</th>
                        <th className="py-2.5 px-2 text-right cursor-pointer select-none hover:text-slate-800" onClick={() => togglePlanSort('amount')}>Monto{sortIcon('amount', planSort)}</th>
                        <th className="py-2.5 px-2 text-right cursor-pointer select-none hover:text-slate-800" onClick={() => togglePlanSort('shares')}>Accs.{sortIcon('shares', planSort)}</th>
                        <th className="py-2.5 px-2 text-center"></th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {sortedPlanItems.map((a) => {
                        const ep = effectivePrice(a);
                        const amt = amountFor(a);
                        const shares = sharesFor(a);
                        return (
                          <tr key={a.ticker} className="hover:bg-slate-50/50 transition">
                            <td className="py-2.5 px-2">
                              <span className="font-semibold text-slate-900">{a.ticker}</span>
                              <span className="text-[10px] text-slate-400 ml-1">{a.name}</span>
                            </td>
                            <td className="py-2.5 px-2 text-right">
                              <input
                                type="number" step="0.1" min="0" max="100"
                                value={a.percent}
                                onChange={(e) => updatePercent(a.ticker, Number(e.target.value))}
                                className="w-14 text-right text-xs border border-slate-200 rounded p-1 font-mono"
                              />
                            </td>
                            <td className="py-2.5 px-2 text-right">
                              <input
                                type="number" step="0.01" min="0"
                                value={ep > 0 ? ep : ''}
                                onChange={(e) => updateBrokerPrice(a.ticker, Number(e.target.value))}
                                placeholder="—"
                                className="w-20 text-right text-xs border border-slate-200 rounded p-1 font-mono text-slate-700"
                              />
                            </td>
                            <td className="py-2.5 px-2 text-right font-mono font-semibold text-slate-900">
                              {formatCLP(amt)}
                            </td>
                            <td className="py-2.5 px-2 text-right font-mono font-semibold text-slate-900">
                              {shares > 0 ? shares.toLocaleString('es-CL') : '—'}
                            </td>
                            <td className="py-2.5 px-2 text-center">
                              <div className="flex items-center justify-center gap-1">
                                <button onClick={() => moveOutside(a.ticker)} className="p-1 text-amber-500 hover:text-amber-600 transition" title="Mover fuera del plan">
                                  <ArrowRight className="w-3.5 h-3.5" />
                                </button>
                                <button onClick={() => removeAllocation(a.ticker)} className="p-1 text-rose-400 hover:text-rose-600 transition" title="Eliminar">
                                  <X className="w-3.5 h-3.5" />
                                </button>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            {/* Outside Grid */}
            <div>
              <h3 className="text-sm font-semibold text-slate-500 bg-slate-100 px-3 py-2 rounded-lg mb-3 flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-slate-400"></span>
                Fuera del Plan ({sortedOutsideItems.length})
              </h3>
              {sortedOutsideItems.length === 0 ? (
                <div className="text-center py-6 text-slate-400 text-xs border border-dashed border-slate-200 rounded-lg">
                  Sin acciones fuera del plan
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs border-collapse">
                    <thead>
                      <tr className="border-b border-slate-200 bg-slate-50/70 text-[11px] font-semibold text-slate-500 uppercase tracking-wider">
                        <th className="py-2.5 px-2 cursor-pointer select-none hover:text-slate-700" onClick={() => toggleOutSort('ticker')}>Acción{sortIcon('ticker', outSort)}</th>
                        <th className="py-2.5 px-2 text-right cursor-pointer select-none hover:text-slate-700" onClick={() => toggleOutSort('price')}>Precio{sortIcon('price', outSort)}</th>
                        <th className="py-2.5 px-2 text-right cursor-pointer select-none hover:text-slate-700" onClick={() => toggleOutSort('amount')}>Monto{sortIcon('amount', outSort)}</th>
                        <th className="py-2.5 px-2 text-right cursor-pointer select-none hover:text-slate-700" onClick={() => toggleOutSort('shares')}>Accs.{sortIcon('shares', outSort)}</th>
                        <th className="py-2.5 px-2 text-center"></th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {sortedOutsideItems.map((a) => {
                        const ep = effectivePrice(a);
                        const amt = amountFor(a);
                        const shares = sharesFor(a);
                        return (
                          <tr key={a.ticker} className="hover:bg-slate-50/50 transition">
                            <td className="py-2.5 px-2">
                              <span className="font-semibold text-slate-500">{a.ticker}</span>
                              <span className="text-[10px] text-slate-400 ml-1">{a.name}</span>
                            </td>
                            <td className="py-2.5 px-2 text-right">
                              <input
                                type="number" step="0.01" min="0"
                                value={ep > 0 ? ep : ''}
                                onChange={(e) => updateBrokerPrice(a.ticker, Number(e.target.value))}
                                placeholder="—"
                                className="w-20 text-right text-xs border border-slate-200 rounded p-1 font-mono text-slate-500"
                              />
                            </td>
                            <td className="py-2.5 px-2 text-right">
                              <input
                                type="number" min="0"
                                value={amt > 0 ? amt : ''}
                                onChange={(e) => updateAmount(a.ticker, Number(e.target.value))}
                                placeholder="—"
                                className="w-24 text-right text-xs border border-slate-200 rounded p-1 font-mono text-slate-700"
                              />
                            </td>
                            <td className="py-2.5 px-2 text-right font-mono font-semibold text-slate-900">
                              {shares > 0 ? shares.toLocaleString('es-CL') : '—'}
                            </td>
                            <td className="py-2.5 px-2 text-center">
                              <div className="flex items-center justify-center gap-1">
                                <button onClick={() => moveToPlan(a.ticker)} className="p-1 text-teal-500 hover:text-teal-600 transition" title="Mover al plan">
                                  <ArrowRight className="w-3.5 h-3.5 rotate-180" />
                                </button>
                                <button onClick={() => removeAllocation(a.ticker)} className="p-1 text-rose-400 hover:text-rose-600 transition" title="Eliminar">
                                  <X className="w-3.5 h-3.5" />
                                </button>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        )}
        </>
        )}

        {planTab === 'proyeccion' && (
        <>
        {/* Proyección 25 años */}
        {(() => {
          const yield_ = weightedYield;
          const yearsToProject = parseInt(yearsStr) || 25;
          const targetMonthly = cleanNum(targetMonthlyStr);

          const now = new Date();
          const currentMonth = now.getMonth() + 1;
          const remainingMonths = 12 - currentMonth + 1;

          const rows: any[] = [];
          let cap = projCapital;
          let monthly = projMonthly;
          const targetAnnual = targetMonthly * 12;
          let metaAlcanzada = false;

          for (let y = 1; y <= yearsToProject; y++) {
            const months = y === 1 ? remainingMonths : 12;
            const calYear = now.getFullYear() + y - 1;
            const annualContrib = monthly * months;
            const avgCap = cap + annualContrib / 2;
            const dividends = Math.round(avgCap * yield_ * months / 12);
            const grossDiv = dividends / 0.73;
            const dividendTax = calcTax(grossDiv);
            const credit = Math.round(grossDiv * 0.27);
            const refund = credit - dividendTax;
            const totalReturn = dividends + refund;
            const metaIncome = incluyeCredito ? totalReturn : dividends;

            if (!metaAlcanzada && targetMonthly > 0 && metaIncome / months >= targetMonthly) {
              metaAlcanzada = true;
            }

            let consumed = 0;
            let reinvested = totalReturn;
            let effectiveContrib = annualContrib;
            if (metaAlcanzada && targetAnnual > 0) {
              const consumible = incluyeCredito ? totalReturn : dividends;
              consumed = Math.min(targetAnnual, consumible);
              reinvested = totalReturn - consumed;
              if (!seguirAportando) effectiveContrib = 0;
            }
            const endCap = cap + effectiveContrib + reinvested;

            const label = y === 1 && months < 12 ? `${y} (${calYear}, ${months}m)` : `${y} (${calYear})`;

            rows.push(
              <tr key={y} className={`hover:bg-slate-50 ${metaAlcanzada ? 'bg-amber-50/40' : ''}`}>
                <td className="py-1.5 px-2 text-slate-600">{label}</td>
                <td className="py-1.5 px-2 text-right">{formatCLP(monthly, true)}</td>
                <td className="py-1.5 px-2 text-right text-slate-500">{formatCLP(annualContrib, true)}</td>
                <td className="py-1.5 px-2 text-right">{formatCLP(Math.round(cap))}</td>
                <td className="py-1.5 px-2 text-right text-emerald-600">{formatCLP(dividends)}</td>
                <td className={`py-1.5 px-2 text-right ${refund >= 0 ? 'text-teal-600' : 'text-rose-600'}`}>{formatCLP(refund)}</td>
                <td className={`py-1.5 px-2 text-right ${metaAlcanzada && consumed > 0 ? 'text-amber-600' : 'text-slate-400'}`}>
                  {consumed > 0 ? formatCLP(consumed) : '—'}
                </td>
                <td className={`py-1.5 px-2 text-right font-bold ${metaAlcanzada ? 'text-amber-700' : 'text-slate-800'}`}>
                  {formatCLP(Math.round(endCap))}
                  {metaAlcanzada && <span className="ml-1 text-[9px] text-amber-600 font-bold">✓ META</span>}
                </td>
                <td className="py-1.5 px-2 text-right text-slate-600">{formatCLP(Math.round(dividends / 12))}</td>
              </tr>
            );

            monthly += projIncrease;
            cap = endCap;
          }

          return (
            <div className="bg-white rounded-xl border border-slate-200 p-5">
              <h3 className="text-sm font-bold text-slate-800 mb-3 flex items-center gap-2">
                <TrendingUp className="w-4 h-4 text-teal-600" />
                Proyección {yearsToProject} años — Dividendo + Efecto fiscal reinvertido
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-3">
                <div className="bg-slate-50 rounded-lg p-3 border border-slate-200">
                  <label className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider block mb-1">
                    Capital Aportado Total
                  </label>
                  <div className="flex items-center gap-1">
                    {overrideCapital ? (
                      <input type="text" inputMode="numeric" value={overrideCapitalValue}
                        onChange={e => {
                          const raw = e.target.value.replace(/[^0-9]/g, '');
                          if (raw === '') { setOverrideCapitalValue(''); return; }
                          setOverrideCapitalValue(formatNum(Number(raw)));
                        }}
                        className="w-full text-sm font-mono font-bold text-slate-900 bg-white border border-slate-300 rounded-lg p-2" />
                    ) : (
                      <div className="w-full text-sm font-mono font-bold text-slate-900 bg-slate-100 border border-slate-200 rounded-lg p-2">
                        ${formatNum(totalCost)}
                      </div>
                    )}
                    <button
                      onClick={() => {
                        if (overrideCapital) {
                          setOverrideCapital(false);
                          setOverrideCapitalValue('');
                        } else {
                          setOverrideCapital(true);
                          setOverrideCapitalValue(formatNum(totalCost));
                        }
                      }}
                      className={`shrink-0 text-[10px] font-medium px-2 py-1.5 rounded-lg border transition ${
                        overrideCapital
                          ? 'bg-teal-50 text-teal-700 border-teal-300 hover:bg-teal-100'
                          : 'bg-slate-100 text-slate-500 border-slate-200 hover:bg-slate-200'
                      }`}
                    >
                      {overrideCapital ? 'Sinc.' : 'Simular'}
                    </button>
                  </div>
                </div>
                <div className="bg-slate-50 rounded-lg p-3 border border-slate-200">
                  <label className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider block mb-1">Valorización de Mercado</label>
                  <div className="w-full text-sm font-mono font-bold text-emerald-600 bg-slate-100 border border-slate-200 rounded-lg p-2">
                    ${formatNum(portfolioValue)}
                  </div>
                </div>
                <div className="bg-slate-50 rounded-lg p-3 border border-slate-200">
                  <label className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider block mb-1">Meta dividendo mensual</label>
                  <input type="text" inputMode="numeric" value={targetMonthlyStr}
                    onChange={e => {
                      const raw = e.target.value.replace(/[^0-9]/g, '');
                      setTargetMonthlyStr(raw ? formatNum(Number(raw)) : '');
                    }}
                    className="w-full text-sm font-mono font-bold text-slate-900 bg-white border border-slate-300 rounded-lg p-2" />
                  <label className="flex items-center gap-1.5 mt-1.5 cursor-pointer select-none">
                    <input type="checkbox" checked={incluyeCredito} onChange={e => setIncluyeCredito(e.target.checked)}
                      className="w-3 h-3 rounded border-slate-300 text-teal-600 focus:ring-teal-500/20" />
                    <span className="text-[10px] text-slate-500">Incluir crédito fiscal</span>
                  </label>
                </div>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-3">
                <div className="bg-slate-50 rounded-lg p-3 border border-slate-200">
                  <label className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider block mb-1">Aporte mensual</label>
                  <input type="text" inputMode="numeric" value={monthlyStr}
                    onChange={e => {
                      const raw = e.target.value.replace(/[^0-9]/g, '');
                      setMonthlyStr(raw ? formatNum(Number(raw)) : '');
                    }}
                    className="w-full text-sm font-mono font-bold text-slate-900 bg-white border border-slate-300 rounded-lg p-2" />
                  <label className="flex items-center gap-1.5 mt-1.5 cursor-pointer select-none">
                    <input type="checkbox" checked={seguirAportando} onChange={e => setSeguirAportando(e.target.checked)}
                      className="w-3 h-3 rounded border-slate-300 text-teal-600 focus:ring-teal-500/20" />
                    <span className="text-[10px] text-slate-500">Seguir aportando tras la meta</span>
                  </label>
                </div>
                <div className="bg-slate-50 rounded-lg p-3 border border-slate-200">
                  <label className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider block mb-1">Aumento anual ($/mes)</label>
                  <input type="text" inputMode="numeric" value={increaseStr}
                    onChange={e => {
                      const raw = e.target.value.replace(/[^0-9]/g, '');
                      setIncreaseStr(raw ? formatNum(Number(raw)) : '');
                    }}
                    className="w-full text-sm font-mono font-bold text-slate-900 bg-white border border-slate-300 rounded-lg p-2" />
                </div>
                <div className="bg-slate-50 rounded-lg p-3 border border-slate-200">
                  <label className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider block mb-1">Años a proyectar</label>
                  <input type="number" min="1" max="50" value={yearsStr}
                    onChange={e => setYearsStr(e.target.value)}
                    className="w-full text-sm font-mono font-bold text-slate-900 bg-white border border-slate-300 rounded-lg p-2" />
                </div>
              </div>
              <div className="bg-slate-50 rounded-lg p-3 border border-slate-200 mb-4">
                <div className="text-[11px] font-medium text-slate-600 leading-relaxed">
                  <span className="font-semibold text-teal-600">Global Complementario:</span> Tramos progresivos SII AT 2026 (0%–40%) sobre dividendo bruto, se resta crédito 27% IDPC.{' '}
                  {targetMonthly > 0 && (
                    <span>Meta: <strong>${formatNum(targetMonthly)}/mes</strong> (~${formatNum(Math.round(targetMonthly * 12))}/año) → capital necesario <strong>${formatNum(Math.round(targetMonthly * 12 / weightedYield))}</strong> al {weightedYield > 0 ? (weightedYield * 100).toFixed(1) : '?'}%.</span>
                  )}
                </div>
              </div>
              <div className="overflow-x-auto max-h-[600px] overflow-y-auto">
                <table className="w-full text-[11px] font-mono border-collapse">
                  <thead className="sticky top-0 bg-white z-10">
                    <tr className="border-b border-slate-300 text-slate-500 font-semibold uppercase tracking-wider text-[10px]">
                      <th className="py-2 px-2 text-left">Año</th>
                      <th className="py-2 px-2 text-right">Aporte/mes</th>
                      <th className="py-2 px-2 text-right">Aporte/año</th>
                      <th className="py-2 px-2 text-right">Capital inicio</th>
                      <th className="py-2 px-2 text-right">Dividendos</th>
                      <th className="py-2 px-2 text-right">Efecto fiscal</th>
                      <th className="py-2 px-2 text-right">Consumido</th>
                      <th className="py-2 px-2 text-right">Capital final</th>
                      <th className="py-2 px-2 text-right">Dividendo/mes</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">{rows}</tbody>
                </table>
              </div>
              <p className="text-[10px] text-slate-400 mt-3 leading-relaxed">
                * Proyección estimada con yield ponderado {(weightedYield * 100).toFixed(1)}% de tu portafolio actual. Año 1 prorrateado ({remainingMonths}m restantes). No considera plusvalía. Global Complementario progresivo (tramos SII AT 2026) sobre dividendo bruto, menos crédito 27% IDPC. Al alcanzar la meta, el dividendo se consume como "sueldo" (columna Consumido) y solo el excedente se reinvierte. Meta se calcula {incluyeCredito ? 'con' : 'sin'} crédito fiscal. {!seguirAportando ? 'Aportes cesan al llegar a la meta. ' : ''}{targetMonthly > 0 ? `Meta: $${formatNum(targetMonthly)}/mes → capital $${formatNum(Math.round(targetMonthly * 12 / weightedYield))}.` : ''}
              </p>
            </div>
          );
        })()}
        </>
        )}
      </div>
    </div>
  );
}
