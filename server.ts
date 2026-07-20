/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import dotenv from 'dotenv';
import express from 'express';
import path from 'path';
import { createServer as createViteServer } from 'vite';
import { createClient } from '@supabase/supabase-js';
import WebSocket from 'ws';

// Load environment variables from .env file
dotenv.config();

// Supabase client for shared market data cache
const supabaseUrl = process.env.VITE_SUPABASE_URL || '';
const supabaseAnonKey = process.env.VITE_SUPABASE_ANON_KEY || '';
const supabase = supabaseUrl && supabaseAnonKey ? createClient(supabaseUrl, supabaseAnonKey, { realtime: { transport: WebSocket as any } }) : null;

// Current local time (dynamic for dividend received/estimated logic)
const CURRENT_DATE_STRING = new Date().toISOString().split('T')[0];

// Correct real fallback values for Chile index indicators in case of API failure
const FALLBACK_UF = 40763.26;
const FALLBACK_UTM = 66224.00;

const INITIAL_MARKET_STOCKS_BACKUP = [
  { ticker: "CHILE", name: "Banco de Chile", price: 175.90, changePercent: 5.33, previousClose: 167.00, dividendYield: 8.4, sector: "Financiero", volumeCLP: 175295736 },
  { ticker: "SQM-B", name: "Sociedad Química y Minera (SQM)", price: 41250.00, changePercent: -1.42, previousClose: 41844.39, dividendYield: 10.2, sector: "Minero & Químico", volumeCLP: 3450000000 },
  { ticker: "ENELCHILE", name: "Enel Chile S.A.", price: 76.00, changePercent: 2.43, previousClose: 74.20, dividendYield: 9.1, sector: "Servicios Públicos", volumeCLP: 980000000 },
  { ticker: "CENCOSHOP", name: "Cencosud Shopping S.A.", price: 2323.00, changePercent: 0.28, previousClose: 2316.51, dividendYield: 7.2, sector: "Inmobiliario Comercial", volumeCLP: 1200000000 },
  { ticker: "COPEC", name: "Empresas Copec S.A.", price: 6119.50, changePercent: 2.33, previousClose: 5979.77, dividendYield: 5.8, sector: "Energía & Recursos", volumeCLP: 1540000000 },
  { ticker: "VAPORES", name: "Cía. Sudamericana de Vapores", price: 43.00, changePercent: 1.32, previousClose: 42.44, dividendYield: 13.8, sector: "Transporte Marítimo", volumeCLP: 2100000000 },
  { ticker: "BSANTANDER", name: "Banco Santander Chile", price: 72.10, changePercent: 5.26, previousClose: 68.50, dividendYield: 8.1, sector: "Financiero", volumeCLP: 1150000000 },
  { ticker: "CMPC", name: "Empresas CMPC S.A.", price: 1910.00, changePercent: -0.55, previousClose: 1920.56, dividendYield: 6.2, sector: "Forestal & Celulosa", volumeCLP: 950000000 },
  { ticker: "FALABELLA", name: "Falabella S.A.", price: 5740.00, changePercent: 2.87, previousClose: 5579.86, dividendYield: 3.2, sector: "Retail", volumeCLP: 1680000000 },
  { ticker: "ANDINA-B", name: "Embotelladora Andina S.A.", price: 2520.00, changePercent: 0.30, previousClose: 2512.46, dividendYield: 6.9, sector: "Consumo Masivo", volumeCLP: 510000000 }
];

// Some tickers use different symbols on Yahoo than our app
const YAHOO_TICKER_ALIASES: Record<string, string> = {
  'CENCOSHOP': 'CENCOMALLS',
  'COLBUM': 'COLBUN',
};

async function startServer() {
  const app = express();
  const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;

  app.use(express.json());

  // In-memory cache for stock quotes with TTL of 1.5 minutes (prevent rate limits)
  const stockCache: { [ticker: string]: { data: any, timestamp: number } } = {};
  const STOCK_CACHE_TTL = 1.5 * 60 * 1000;

  // Cache for Chile index indicators (UF & UTM) from mindicador.cl with TTL of 1 hour
  let indicatorsCache: { data: any, timestamp: number } | null = null;
  const INDICATORS_CACHE_TTL = 60 * 60 * 1000;

  // Fetch stock data from Yahoo Finance chart API
  async function fetchStockFromYahooChart(ticker: string): Promise<any> {
    const cleanTicker = ticker.trim().toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace('.SN', '');
    const now = Date.now();

    if (stockCache[cleanTicker] && (now - stockCache[cleanTicker].timestamp < STOCK_CACHE_TTL)) {
      return stockCache[cleanTicker].data;
    }

    const possibleSymbols: string[] = [];
    const aliasTicker = YAHOO_TICKER_ALIASES[cleanTicker];
    if (cleanTicker.startsWith('^')) {
      possibleSymbols.push(cleanTicker);
    } else {
      possibleSymbols.push(`${cleanTicker}.SN`);
      possibleSymbols.push(cleanTicker);
      if (aliasTicker) {
        possibleSymbols.push(`${aliasTicker}.SN`);
        possibleSymbols.push(aliasTicker);
      }
    }

    let chartData: any = null;
    let usedSymbol = '';
    let lastError = '';

    for (const symbol of possibleSymbols) {
      const urls = [
        `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?interval=1d&range=1y&events=div`,
        `https://query2.finance.yahoo.com/v8/finance/chart/${symbol}?interval=1d&range=1y&events=div`
      ];
      for (const url of urls) {
        try {
          const response = await fetch(url, {
            headers: {
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
              'Accept': 'application/json, text/plain, */*',
              'Cache-Control': 'no-cache'
            }
          });
          if (response.ok) {
            chartData = await response.json();
            usedSymbol = symbol;
            break;
          } else {
            lastError = `Status ${response.status}`;
          }
        } catch (err: any) {
          lastError = err.message || err;
        }
      }
      if (chartData) break;
    }

    if (!chartData) {
      if (stockCache[cleanTicker]) {
        console.warn(`[Yahoo] Fetch failed for ${cleanTicker} (${lastError}), returning expired cache.`);
        return stockCache[cleanTicker].data;
      }
      const backupItem = INITIAL_MARKET_STOCKS_BACKUP.find(s => s.ticker === cleanTicker);
      console.warn(`[Yahoo] Fetch failed for ${cleanTicker} (${lastError}), using backup.`);
      if (backupItem) return backupItem;
      return {
        ticker: cleanTicker, name: `${cleanTicker} S.A.`, price: 1500.0,
        changePercent: 0.0, dividendYield: 5.5, sector: "Bolsa de Santiago", volumeCLP: 1200000000
      };
    }

    try {
      const result = chartData?.chart?.result?.[0];
      const meta = result?.meta;
      if (!meta) {
        if (stockCache[cleanTicker]) return stockCache[cleanTicker].data;
        throw new Error(`Incomplete chart payload for ${cleanTicker}`);
      }
      const price = meta.regularMarketPrice || 150.0;
      const quotes = result.indicators?.quote?.[0];
      const closes = quotes?.close || [];
      let todayClose = null, yesterdayClose = null;
      for (let i = closes.length - 1; i >= 0; i--) {
        if (closes[i] !== null && todayClose === null) { todayClose = closes[i]; continue; }
        if (closes[i] !== null && todayClose !== null && yesterdayClose === null) { yesterdayClose = closes[i]; break; }
      }
      const previousClose = yesterdayClose !== null ? yesterdayClose : meta.chartPreviousClose || price;
      const changePercent = (previousClose > 0) ? ((price - previousClose) / previousClose) * 100 : 0;
      const volumes = quotes?.volume || [];
      let volumeCLP = 0;
      for (let i = volumes.length - 1; i >= 0; i--) { if (volumes[i] !== null) { volumeCLP = volumes[i]; break; } }
      if (!volumeCLP) volumeCLP = 1500000;
      const backupItem = INITIAL_MARKET_STOCKS_BACKUP.find(s => s.ticker === cleanTicker);
      let companyName = cleanTicker + " S.A.";
      if (backupItem) companyName = backupItem.name;
      const marketDate = meta.regularMarketTime
        ? new Date(meta.regularMarketTime * 1000).toISOString().split('T')[0]
        : new Date().toISOString().split('T')[0];
      const processedData = {
        ticker: cleanTicker, name: companyName, price: Math.round(price * 100) / 100,
        changePercent: Math.round(changePercent * 100) / 100,
        previousClose: Math.round(previousClose * 100) / 100,
        dividendYield: backupItem ? backupItem.dividendYield : 6.0,
        sector: backupItem ? backupItem.sector : "Bolsa de Santiago",
        volumeCLP: Math.round(volumeCLP),
        marketDate
      };
      stockCache[cleanTicker] = { data: processedData, timestamp: now };
      return processedData;
    } catch (err: any) {
      console.error(`[Yahoo] Error parsing ${cleanTicker}:`, err);
      const backupItem = INITIAL_MARKET_STOCKS_BACKUP.find(s => s.ticker === cleanTicker);
      return backupItem || { ticker: cleanTicker, name: `${cleanTicker} S.A.`, price: 1500.0,
        changePercent: 0.0, previousClose: 1500.0, dividendYield: 6.0, sector: "Bolsa de Santiago", volumeCLP: 1000000000 };
    }
  }

  // Main fetch function: always use Yahoo Finance
  async function fetchStockPrice(ticker: string): Promise<any> {
    return fetchStockFromYahooChart(ticker);
  }

  const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

  app.get('/api/portfolio-history', async (req, res) => {
    try {
      const tickersParam = req.query.tickers;
      if (!tickersParam || typeof tickersParam !== 'string') {
        return res.status(400).json({ error: "Debe proveer tickers separados por coma" });
      }
      const tickers = tickersParam.split(',').map(t => t.trim().toUpperCase()).filter(Boolean);
      const startDateParam = req.query.startDate;
      const endDateParam = req.query.endDate;

      const results = await Promise.all(tickers.map(async (ticker) => {
        const cleanTicker = ticker.trim().toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
        const cacheKey = `portfolio_history_${cleanTicker}`;

        // Helper: date string for N days ago
        const daysAgo = (n: number) => {
          const d = new Date();
          d.setDate(d.getDate() - n);
          return d.toISOString().split('T')[0];
        };
        const twoDaysAgo = daysAgo(2);

        // 1. Check Supabase cache (skip when explicit date range requested — need fresh data)
        if (supabase && !startDateParam && !endDateParam) {
          try {
            const { data: cached } = await supabase
              .from('market_data')
              .select('data, updated_at')
              .eq('key', cacheKey)
              .single();

            if (cached) {
              const history = cached.data as { date: string; close: number }[];
              if (history.length > 0) {
                // Find latest date in cache
                const latestDate = history.reduce((latest, entry) =>
                  entry.date > latest ? entry.date : latest, '');
                // If cache covers up to at most 2 days ago, it's complete (history is immutable)
                // For indices (^) with < 2 entries, supplement with chartPreviousClose or re-fetch
                if (cleanTicker.startsWith('^') && history.length < 2) {
                  // Fall through to re-fetch to get chartPreviousClose
                } else if (latestDate >= twoDaysAgo) {
                  return { ticker: cleanTicker, history, fromCache: true };
                }
              }
            }
          } catch { /* cache miss, continue to fetch */ }
        }

        // 2. Fetch from Yahoo (with alias support)
        try {
          const possibleSymbols: string[] = [];
          const aliasTicker = YAHOO_TICKER_ALIASES[cleanTicker];
          if (cleanTicker.startsWith('^')) {
            possibleSymbols.push(cleanTicker);
          } else {
            possibleSymbols.push(`${cleanTicker}.SN`);
            possibleSymbols.push(cleanTicker);
          }
          if (aliasTicker) {
            possibleSymbols.push(`${aliasTicker}.SN`);
            possibleSymbols.push(aliasTicker);
          }

          let yahooHistory: { date: string; close: number }[] = [];
          let chartPreviousClose: number | null = null;
          const yahooRange = startDateParam && endDateParam
            ? `period1=${Math.floor(new Date(startDateParam + 'T12:00:00').getTime() / 1000)}&period2=${Math.floor(new Date(endDateParam + 'T12:00:00').getTime() / 1000)}`
            : 'range=1y';
          const yahooHeaders = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            'Accept': 'application/json; charset=utf-8',
            'Accept-Language': 'en-US,en;q=0.9',
            'Origin': 'https://finance.yahoo.com',
            'Referer': 'https://finance.yahoo.com/',
          };
          for (const sym of possibleSymbols) {
            for (const host of ['query1', 'query2']) {
              const url = `https://${host}.finance.yahoo.com/v8/finance/chart/${sym}?interval=1d&${yahooRange}&events=div`;
              const response = await fetch(url, { headers: yahooHeaders });
              if (!response.ok) continue;
              const data: any = await response.json();
              const result = data?.chart?.result?.[0];
              if (!result) continue;
              const timestamps: number[] = result.timestamp || [];
              const closes: (number | null)[] = result.indicators?.quote?.[0]?.close || [];
              for (let i = 0; i < timestamps.length; i++) {
                if (closes[i] !== null && closes[i] !== undefined) {
                  const date = new Date(timestamps[i] * 1000).toISOString().split('T')[0];
                  yahooHistory.push({ date, close: Math.round(closes[i]! * 100) / 100 });
                }
              }
              // Indices like ^IPSA often return only 1 data point; supplement with chartPreviousClose
              if (yahooHistory.length < 2 && result?.meta?.chartPreviousClose) {
                const prevClose = result.meta.chartPreviousClose;
                const lastDate = yahooHistory.length > 0 ? yahooHistory[0].date : new Date().toISOString().split('T')[0];
                const prevDate = new Date(new Date(lastDate).getTime() - 86400000).toISOString().split('T')[0];
                if (!yahooHistory.some(e => e.date === prevDate)) {
                  yahooHistory.push({ date: prevDate, close: Math.round(prevClose * 100) / 100 });
                  yahooHistory.sort((a, b) => a.date.localeCompare(b.date));
                }
              }
              if (yahooHistory.length > 0) break;
            }
            if (yahooHistory.length > 0) break;
          }
          if (yahooHistory.length === 0) {
            console.warn(`[PortfolioHistory] No data for ${cleanTicker} from any symbol (tried: ${possibleSymbols.join(', ')})`);
          }

          // 3. Merge with existing cache: keep cached data for dates > 2 days ago (immutable),
          //    use Yahoo data for recent dates or dates not in cache
          let merged = yahooHistory;
          if (supabase) {
            try {
              const { data: existing } = await supabase
                .from('market_data')
                .select('data')
                .eq('key', cacheKey)
                .single();

              if (existing) {
                const cachedMap = new Map(
                  (existing.data as { date: string; close: number }[]).map(e => [e.date, e.close])
                );
                for (const entry of yahooHistory) {
                  if (cachedMap.has(entry.date) && entry.date <= twoDaysAgo) {
                    // Keep cached value for historical dates
                    entry.close = cachedMap.get(entry.date)!;
                  }
                }
                // Add any cached dates not returned by Yahoo
                const yahooDates = new Set(yahooHistory.map(e => e.date));
                for (const [date, close] of cachedMap) {
                  if (!yahooDates.has(date)) {
                    yahooHistory.push({ date, close });
                  }
                }
                yahooHistory.sort((a, b) => a.date.localeCompare(b.date));
                merged = yahooHistory;
              }
            } catch { /* merge best-effort */ }
          }

          // 4. Save merged result to Supabase cache (full history, unfiltered)
          if (supabase && merged.length > 0) {
            try {
              await supabase.from('market_data').upsert(
                { key: cacheKey, data: merged, updated_at: new Date().toISOString() },
                { onConflict: 'key' }
              );
            } catch { /* cache save best-effort */ }
          }

          // Supplement indices with chartPreviousClose if still < 2 entries
          if (merged.length < 2 && chartPreviousClose && cleanTicker.startsWith('^')) {
            const lastDate = merged.length > 0 ? merged[0].date : new Date().toISOString().split('T')[0];
            const prevDate = new Date(new Date(lastDate).getTime() - 86400000).toISOString().split('T')[0];
            if (!merged.some(e => e.date === prevDate)) {
              merged.push({ date: prevDate, close: Math.round(chartPreviousClose * 100) / 100 });
              merged.sort((a, b) => a.date.localeCompare(b.date));
            }
          }
          // Filter by requested date range before returning
          if (startDateParam && endDateParam) {
            const startD = startDateParam;
            const endD = endDateParam;
            merged = merged.filter(d => d.date >= startD && d.date <= endD);
          }
          return { ticker: cleanTicker, history: merged };
        } catch (err: any) {
          console.warn(`[PortfolioHistory] Error fetching ${cleanTicker}: ${err?.message || err}`);
          return { ticker: cleanTicker, history: [] };
        }
      }));

      res.json(results);
    } catch (err: any) {
      console.error("Error fetching portfolio history:", err?.message || err);
      res.status(500).json({ error: "Error al obtener historial de precios" });
    }
  });

  // NEW: Backfill missing historical data from last saved date up to yesterday
  app.post('/api/backfill-history', async (req, res) => {
    try {
      const { tickers, lastSavedDate } = req.body;
      if (!tickers || !Array.isArray(tickers) || tickers.length === 0 || !lastSavedDate) {
        return res.status(400).json({ error: "Debe proveer tickers y lastSavedDate" });
      }

      // Calculate date range: from day after lastSavedDate up to yesterday (not today)
      const startDate = new Date(lastSavedDate);
      startDate.setDate(startDate.getDate() + 1);
      const endDate = new Date();
      endDate.setDate(endDate.getDate() - 1); // yesterday

      if (startDate > endDate) {
        return res.json({ results: [], message: "No hay fechas faltantes para rellenar" });
      }

      const startStr = startDate.toISOString().split('T')[0];
      const endStr = endDate.toISOString().split('T')[0];

      console.log(`[Backfill] Fetching ${tickers.length} tickers from ${startStr} to ${endStr}`);

      const results = await Promise.all(tickers.map(async (ticker: string) => {
        const cleanTicker = ticker.trim().toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace('.SN', '');
        const cacheKey = `portfolio_history_${cleanTicker}`;

        try {
          const possibleSymbolsBf: string[] = [];
          const aliasTickerBf = YAHOO_TICKER_ALIASES[cleanTicker];
          possibleSymbolsBf.push(`${cleanTicker}.SN`);
          possibleSymbolsBf.push(cleanTicker);
          if (aliasTickerBf) {
            possibleSymbolsBf.push(`${aliasTickerBf}.SN`);
            possibleSymbolsBf.push(aliasTickerBf);
          }

          const history: { date: string; close: number }[] = [];
          for (const sym of possibleSymbolsBf) {
            const url = `https://query1.finance.yahoo.com/v8/finance/chart/${sym}?interval=1d&range=1y`;
            const response = await fetch(url, {
              headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                'Accept': 'application/json'
              }
            });
            if (!response.ok) continue;
            const data: any = await response.json();
            const result = data?.chart?.result?.[0];
            if (!result) continue;
            const timestamps: number[] = result.timestamp || [];
            const closes: (number | null)[] = result.indicators?.quote?.[0]?.close || [];
            for (let i = 0; i < timestamps.length; i++) {
              if (closes[i] !== null && closes[i] !== undefined) {
                const date = new Date(timestamps[i] * 1000).toISOString().split('T')[0];
                if (date >= startStr && date <= endStr) {
                  history.push({ date, close: Math.round(closes[i]! * 100) / 100 });
                }
              }
            }
            if (history.length > 0) break;
          }

          // Merge with existing cache if any
          let merged = history;
          if (supabase && history.length > 0) {
            try {
              const { data: existing } = await supabase
                .from('market_data')
                .select('data')
                .eq('key', cacheKey)
                .single();

              if (existing) {
                const cachedMap = new Map(
                  (existing.data as { date: string; close: number }[]).map(e => [e.date, e.close])
                );
                // Keep cached values for historical dates (≤ 2 days ago from now)
                const twoDaysAgo = new Date();
                twoDaysAgo.setDate(twoDaysAgo.getDate() - 2);
                const twoDaysAgoStr = twoDaysAgo.toISOString().split('T')[0];

                for (const entry of history) {
                  if (cachedMap.has(entry.date) && entry.date <= twoDaysAgoStr) {
                    entry.close = cachedMap.get(entry.date)!;
                  }
                }
                // Add any cached dates not in Yahoo result
                const yahooDates = new Set(history.map(e => e.date));
                for (const [date, close] of cachedMap) {
                  if (!yahooDates.has(date)) {
                    history.push({ date, close });
                  }
                }
                history.sort((a, b) => a.date.localeCompare(b.date));
                merged = history;
              }
            } catch { /* merge best-effort */ }
          }

          // Save merged result to Supabase cache
          if (supabase && merged.length > 0) {
            try {
              await supabase.from('market_data').upsert(
                { key: cacheKey, data: merged, updated_at: new Date().toISOString() },
                { onConflict: 'key' }
              );
            } catch { /* cache save best-effort */ }
          }

          return { ticker: cleanTicker, history: merged };
        } catch {
          return { ticker: cleanTicker, history: [] };
        }
      }));

      res.json({ results });
    } catch (err: any) {
      console.error("Error backfilling history:", err?.message || err);
      res.status(500).json({ error: "Error al rellenar historial" });
    }
  });

  app.get('/api/market-stocks', async (req, res) => {
    try {
      const tickers = ["CHILE", "SQM-B", "ENELCHILE", "CENCOSHOP", "COPEC", "VAPORES", "BSANTANDER", "CMPC", "FALABELLA", "ANDINA-B"];
      
      let additionalTickers: string[] = [];
      if (req.query.additional && typeof req.query.additional === 'string') {
        additionalTickers = req.query.additional
          .split(',')
          .map(t => t.trim().toUpperCase())
          .filter(t => t && !tickers.includes(t));
      }
      
      const allTickers = [...tickers, ...additionalTickers];

      // 2. Fetch from Yahoo
      const quotes = await Promise.all(allTickers.map(async (t) => {
        try {
          return await fetchStockPrice(t);
        } catch (err) {
          console.warn(`Failed fetching ${t}, serving loaded backup:`);
          return INITIAL_MARKET_STOCKS_BACKUP.find(item => item.ticker === t) || {
            ticker: t,
            name: `${t} S.A.`,
            price: 1500.0,
            changePercent: 0.0,
            dividendYield: 5.5,
            sector: "Bolsa de Santiago",
            volumeCLP: 1200000000
          };
        }
      }));

      res.json(quotes);
    } catch (err: any) {
      console.error("Error fetching market-stocks proxy:", err?.message || err);
      // Fallback: send the entire backups so the client is always styling-happy and fast
      res.json(INITIAL_MARKET_STOCKS_BACKUP);
    }
  });

  // API Route: Custom Stock Search (Real-time and extendable search bar)
  app.get('/api/search-stock', async (req, res) => {
    try {
      const ticker = req.query.ticker;
      if (!ticker || typeof ticker !== 'string') {
        return res.status(400).json({ error: "Debe proveer un ticker de búsqueda" });
      }

      const cleanTicker = ticker.trim().toUpperCase().replace('.SN', '');
      if (!cleanTicker) {
        return res.status(400).json({ error: "Nemotécnico inválido" });
      }

      // 1. Check Supabase per-ticker cache first
      if (supabase) {
        try {
          const cacheKey = `search_${cleanTicker}`;
          const { data: cached } = await supabase
            .from('market_data')
            .select('data, updated_at')
            .eq('key', cacheKey)
            .single();

          if (cached) {
            const age = Date.now() - new Date(cached.updated_at).getTime();
            if (age < CACHE_TTL) {
              // Validate cached data is not the hardcoded fallback
              const cachedData = cached.data as any;
              if (cachedData && cachedData.previousClose != null && cachedData.previousClose > 0) {
                console.log(`Serving ${cleanTicker} from Supabase cache`);
                return res.json(cached.data);
              }
              // Fallback data in cache - treat as stale, re-fetch
              console.log(`Supabase cache invalid (fallback) for ${cleanTicker}, re-fetching from Yahoo`);
            } else {
              console.log(`Supabase cache stale for ${cleanTicker}, re-fetching from Yahoo`);
            }
          }
        } catch (err) {
          console.warn(`Supabase cache check failed for ${cleanTicker}, falling back to Yahoo:`, err);
        }
      }

      // 2. Fetch from Yahoo
      const data = await fetchStockPrice(cleanTicker);

      // Validate: if result is hardcoded fallback (no previousClose), treat as not found
      if (data && data.ticker && (data.previousClose == null || data.previousClose <= 0) && data.changePercent === 0) {
        return res.status(404).json({ error: `Nemotécnico "${cleanTicker}" no encontrado en Yahoo Finance` });
      }

      // 3. Save to Supabase per-ticker cache
      if (supabase) {
        try {
          const cacheKey = `search_${cleanTicker}`;
          await supabase.from('market_data').upsert(
            { key: cacheKey, data, updated_at: new Date().toISOString() },
            { onConflict: 'key' }
          );
        } catch (err) {
          console.warn(`Failed to save ${cleanTicker} to Supabase cache:`, err);
        }
      }

      res.json(data);
    } catch (err: any) {
      console.error(`Error in search-stock dynamic API for ${req.query.ticker}:`, err?.message || err);
      res.status(500).json({ error: err.message || "Error al buscar acción en Bolsa de Santiago" });
    }
  });

  // API Route: Intraday prices for today (5-min intervals from Yahoo)
  app.get('/api/intraday-prices', async (req, res) => {
    try {
      const tickersParam = req.query.tickers;
      if (!tickersParam || typeof tickersParam !== 'string') {
        return res.status(400).json({ error: "Debe proveer tickers separados por coma" });
      }
      const tickers = tickersParam.split(',').map(t => t.trim().toUpperCase()).filter(Boolean);
      const headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'application/json; charset=utf-8',
        'Accept-Language': 'en-US,en;q=0.9',
        'Origin': 'https://finance.yahoo.com',
        'Referer': 'https://finance.yahoo.com/',
      };
      const results = await Promise.all(tickers.map(async (ticker) => {
        const cleanTicker = ticker.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
        const symbols: string[] = cleanTicker.startsWith('^') ? [cleanTicker] : [`${cleanTicker}.SN`, cleanTicker];
        for (const sym of symbols) {
          for (const host of ['query1', 'query2']) {
            try {
              const url = `https://${host}.finance.yahoo.com/v8/finance/chart/${sym}?interval=5m&range=1d`;
              const response = await fetch(url, { headers });
              if (!response.ok) continue;
              const data: any = await response.json();
              const result = data?.chart?.result?.[0];
              if (!result) continue;
              const timestamps: number[] = result.timestamp || [];
              const closes: (number | null)[] = result.indicators?.quote?.[0]?.close || [];
              const prices: { time: string; close: number; ts: number }[] = [];
              for (let i = 0; i < timestamps.length; i++) {
                if (closes[i] !== null && closes[i] !== undefined) {
                  const d = new Date(timestamps[i] * 1000);
                  const timeStr = d.toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Santiago', hour12: false });
                  prices.push({ time: timeStr, close: Math.round(closes[i]! * 100) / 100, ts: timestamps[i] * 1000 });
                }
              }
              return { ticker: cleanTicker, prices };
            } catch { continue; }
          }
        }
        return { ticker: cleanTicker, prices: [] };
      }));
      res.json(results);
    } catch (err: any) {
      console.error("Error fetching intraday prices:", err?.message || err);
      res.status(500).json({ error: "Error al obtener precios intradiarios" });
    }
  });

  // API Route: Chile Indicators (Retrieve real UT & UTM values from Chile indicators API + Yahoo Finance)
  app.get('/api/chile-indicators', async (req, res) => {
    const now = Date.now();

    // Check in-memory cache
    if (indicatorsCache && (now - indicatorsCache.timestamp < INDICATORS_CACHE_TTL)) {
      return res.json(indicatorsCache.data);
    }

    // Default 2026 updated fallbacks based on real SII indices
    const FALLBACK_UF = 40763.26;
    const FALLBACK_UTM = 66224.00;
    const FALLBACK_USD = 894.99;
    
    let ufVal = FALLBACK_UF;
    let utmVal = FALLBACK_UTM;
    let usdVal = FALLBACK_USD;
    let usdChangeVal = -0.05;
    let ipsaVal = 6480.20;
    let ipsaChangeVal = 0.35;

    // 1. Fetch UF, UTM and Dolar from mindicador.cl
    try {
      const response = await fetch('https://mindicador.cl/api', {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        }
      });
      
      if (response.ok) {
        const data = await response.json();
        // Use mindicador only if it returns realistic modern values (not extremely old/broken ones)
        if (data?.uf?.valor && data.uf.valor > 39000) {
          ufVal = data.uf.valor;
        }
        if (data?.utm?.valor && data.utm.valor > 60000) {
          utmVal = data.utm.valor;
        }
        if (data?.dolar?.valor && data.dolar.valor > 700 && data.dolar.valor < 1100) {
          usdVal = data.dolar.valor;
        }
        console.log("Fetched mindicador.cl indicators: UF=", ufVal, "UTM=", utmVal, "USD=", usdVal);
      } else {
        console.warn(`mindicador.cl returned status ${response.status}, utilizing fallbacks`);
      }
    } catch (err: any) {
      console.warn("Could not fetch indicators from mindicador.cl, relying on fallbacks:", err?.message || err);
    }

    // 2. Fetch live S&P/CLX IPSA from Yahoo (with ^IPSA ticker of Bolsa de Santiago)
    try {
      const ipsaData = await fetchStockPrice("^IPSA");
      if (ipsaData && ipsaData.price && ipsaData.price > 1000) {
        ipsaVal = ipsaData.price;
        ipsaChangeVal = ipsaData.changePercent;
        console.log("Fetched live S&P/CLX IPSA from Yahoo:", ipsaVal, `(${ipsaChangeVal}%)`);
      }
    } catch (e: any) {
      console.warn("Could not retrieve dynamic IPSA from Yahoo:", e?.message || e);
    }

    // 3. Fetch live USD/CLP (CLP=X) from Yahoo to see if we can get real-time currency ticker
    try {
      const usdData = await fetchStockPrice("CLP=X");
      if (usdData && usdData.price && usdData.price > 700 && usdData.price < 1150) {
        // Only override if we don't have a reliable mindicador value or to keep it close to SII
        usdVal = usdData.price;
        usdChangeVal = usdData.changePercent;
        console.log("Fetched live USD/CLP from Yahoo:", usdVal, `(${usdChangeVal}%)`);
      }
    } catch (e: any) {
      console.warn("Could not retrieve live USD/CLP from Yahoo:", e?.message || e);
    }

    // Double check to ensure we always return correct values close to SII if sandbox or APIs returned extremely old values 
    if (ufVal < 40000) {
      ufVal = FALLBACK_UF;
    }
    if (usdVal > 1000 || usdVal < 800) {
      usdVal = FALLBACK_USD;
    }

    const payload = {
      uf: ufVal,
      utm: utmVal,
      dolar: usdVal,
      dolarChange: usdChangeVal,
      ipsa: ipsaVal,
      ipsaChange: ipsaChangeVal
    };

    indicatorsCache = { data: payload, timestamp: now };
    res.json(payload);
  });

  // API Route: Dividend history sync based on user holdings
  app.post('/api/sync-dividends', async (req, res) => {
    try {
      const holdings = req.body?.holdings || [];
      if (!Array.isArray(holdings) || holdings.length === 0) {
        return res.json([]);
      }

      const results: any[] = [];
      
      // Fetch for each ticker in parallel
      // Group holdings by ticker to aggregate shares and find earliest buyDate
      const tickerGroups = new Map<string, { shares: number; buyDate: string }>();
      for (const h of holdings) {
        const t = h.ticker?.trim().toUpperCase() || '';
        if (!t) continue;
        const existing = tickerGroups.get(t);
        if (existing) {
          existing.shares += Number(h.shares) || 0;
          if (h.buyDate < existing.buyDate) existing.buyDate = h.buyDate;
        } else {
          tickerGroups.set(t, { shares: Number(h.shares) || 0, buyDate: h.buyDate || '2000-01-01' });
        }
      }

      await Promise.all(Array.from(tickerGroups.entries()).map(async ([ticker, group]) => {
        const { buyDate, shares } = group;

      const cleanTicker = ticker.trim().toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace('.SN', '');
        const aliasTicker = YAHOO_TICKER_ALIASES[cleanTicker];
        const symbols: string[] = [];
        if (cleanTicker.startsWith('^')) {
          symbols.push(cleanTicker);
        } else {
          symbols.push(`${cleanTicker}.SN`, cleanTicker);
          if (aliasTicker) {
            symbols.push(`${aliasTicker}.SN`, aliasTicker);
          }
        }
        
        let data: any = null;
        for (const symbol of symbols) {
          const urls = [
            `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?interval=1d&range=3y&events=div`,
            `https://query2.finance.yahoo.com/v8/finance/chart/${symbol}?interval=1d&range=3y&events=div`
          ];
          for (const url of urls) {
            try {
              const response = await fetch(url, { 
                headers: { 
                  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' 
                } 
              });
              if (response.ok) {
                data = await response.json();
                break;
              } else {
                console.warn(`Yahoo returned status ${response.status} for event sync from ${url}`);
              }
            } catch (err: any) {
              console.error(`Failed to connect to ${url} for ${ticker}:`, err?.message || err);
            }
          }
          if (data) break;
        }
        
        try {
          if (!data) return;
          const divEvents = data?.chart?.result?.[0]?.events?.dividends;
          
          // Collect all dividend events sorted by date
          const allDivs: { date: string; amount: number; timestamp: number }[] = [];
          if (divEvents && typeof divEvents === 'object') {
            Object.values(divEvents).forEach((d: any) => {
              const exDate = new Date(d.date * 1000).toISOString().split('T')[0];
              allDivs.push({ date: exDate, amount: Number(d.amount), timestamp: d.date });
            });
          }
          allDivs.sort((a, b) => a.timestamp - b.timestamp);

          // 1. Include past dividends where exDate >= buyDate (user owned the stock)
          for (const d of allDivs) {
            if (d.date >= buyDate && d.date <= CURRENT_DATE_STRING) {
              results.push({
                id: `div-sys-${ticker}-${d.timestamp}`,
                ticker,
                sharesCount: shares,
                amountPerShare: d.amount,
                totalAmount: Math.round(shares * d.amount),
                payoutDate: d.date,
                cutoffDate: d.date,
                received: true
              });
            }
          }

          // 2. Estimate future dividend from historical pattern
          if (allDivs.length >= 2) {
            // Calculate average gap between payments
            let totalGap = 0;
            for (let i = 1; i < allDivs.length; i++) {
              totalGap += allDivs[i].timestamp - allDivs[i-1].timestamp;
            }
            const avgGapDays = totalGap / (allDivs.length - 1) / 86400;
            const lastDiv = allDivs[allDivs.length - 1];
            const nextDate = new Date((lastDiv.timestamp + totalGap / (allDivs.length - 1)) * 1000);
            const nextDateStr = nextDate.toISOString().split('T')[0];

            // Only estimate if next date is within 12 months and in the future
            const oneYearFromNow = new Date();
            oneYearFromNow.setFullYear(oneYearFromNow.getFullYear() + 1);
            const oneYearFromNowStr = oneYearFromNow.toISOString().split('T')[0];

            if (nextDateStr > CURRENT_DATE_STRING && nextDateStr <= oneYearFromNowStr) {
              // Use average of last 2-3 amounts as estimated amount
              const recentAmounts = allDivs.slice(-3).map(d => d.amount);
              const estAmount = recentAmounts.reduce((s, a) => s + a, 0) / recentAmounts.length;

              // Calculate estimated cutoffDate (day before ex-date typically)
              const cutoffDate = new Date(nextDate.getTime() - 6 * 86400000);
              const cutoffDateStr = cutoffDate.toISOString().split('T')[0];

              results.push({
                id: `div-sys-${ticker}-est-${nextDateStr}`,
                ticker,
                sharesCount: shares,
                amountPerShare: Math.round(estAmount * 100) / 100,
                totalAmount: Math.round(shares * Math.round(estAmount * 100) / 100),
                payoutDate: nextDateStr,
                cutoffDate: cutoffDateStr,
                received: false,
                estimated: true
              });
            }
          }
        } catch (err: any) {
          console.error(`Error syncing dividends for ticker ${ticker}:`, err?.message || err);
        }
      }));

      // Sort chronological by payout date desc
      results.sort((a, b) => new Date(b.payoutDate).getTime() - new Date(a.payoutDate).getTime());

      if (results.length === 0) {
        console.warn(`Sync dividends: no results found for ${holdings.length} holdings.`);
      } else {
        console.log(`Sync dividends: ${results.length} results for ${holdings.length} holdings.`);
      }
      res.json(results);
    } catch (err: any) {
      console.error("Error in sync-dividends API:", err?.message || err);
      res.status(500).json({ error: err.message });
    }
  });

  // API: IPSA historical data from findic.cl (free, no API key needed)
  app.get('/api/ipsa-history', async (req, res) => {
    try {
      const cacheKey = 'ipsa_history_findic_v2';
      const force = req.query.force === '1';
      if (supabase && !force) {
        try {
          const { data: cached } = await supabase.from('market_data').select('data, updated_at').eq('key', cacheKey).single();
          if (cached?.data && Array.isArray(cached.data)) {
            return res.json({ history: cached.data, fromCache: true });
          }
        } catch {}
      }
      const resp = await fetch('https://findic.cl/bjf/ipsa.json', {
        headers: { 'User-Agent': 'Mozilla/5.0' }
      });
      if (!resp.ok) return res.status(502).json({ error: 'findic.cl unavailable' });
      const data: any = await resp.json();
      const serie: { fecha: string; valor: number }[] = data?.serie || [];
      // bjf/ipsa.json is newest-first; reverse to oldest-first
      const history = serie.reverse().map((d: any) => ({ date: d.fecha, close: Math.round(d.valor * 100) / 100 }));
      if (supabase && history.length > 0) {
        try { await supabase.from('market_data').upsert({ key: cacheKey, data: history, updated_at: new Date().toISOString() }, { onConflict: 'key' }); } catch {}
      }
      res.json({ history });
    } catch (err: any) {
      console.error('Error fetching IPSA history:', err?.message || err);
      res.status(500).json({ error: 'Error al obtener historial IPSA' });
    }
  });

  // Serve static frontend assets
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath, {
      setHeaders: (res, filePath) => {
        if (filePath.endsWith('sw.js') || filePath.endsWith('index.html')) {
          res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
        } else if (filePath.match(/\.(js|css)\b/)) {
          res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
        }
      }
    }));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  const server = app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });

  // ── Background worker: intraday snapshots every 3 min during market hours ──
  try {
    (async function startIntradayWorker() {
      const supabaseUrl = process.env.VITE_SUPABASE_URL || '';
      const supabaseAnonKey = process.env.VITE_SUPABASE_ANON_KEY || '';
      const supabaseUser = process.env.SUPABASE_USER || '';
      const supabasePass = process.env.SUPABASE_PASS || '';

      if (!supabaseUrl || !supabaseAnonKey || !supabaseUser || !supabasePass) {
        console.log('[IntradayWorker] Missing credentials, skipping');
        return;
      }

      const workerClient = createClient(supabaseUrl, supabaseAnonKey, {
        auth: { persistSession: false },
        realtime: { transport: WebSocket as any },
      });
    let workerUserId: string | null = null;

    async function ensureAuth(): Promise<boolean> {
      if (workerUserId) return true;
      try {
        const { error: signInError } = await workerClient.auth.signInWithPassword({
          email: supabaseUser,
          password: supabasePass,
        });
        if (signInError) { console.error('[IntradayWorker] SignIn error:', signInError.message); return false; }
        const { data: { user } } = await workerClient.auth.getUser();
        if (!user) return false;
        workerUserId = user.id;
        console.log('[IntradayWorker] Authenticated as', supabaseUser, 'userId:', workerUserId);
        return true;
      } catch (e: any) {
        console.error('[IntradayWorker] Auth exception:', e?.message);
        return false;
      }
    }

    function getCLTDate(): string {
      return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Santiago' });
    }
    function getCLTTime(): string {
      return new Date().toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Santiago', hour12: false });
    }
    function getCLTHourMin(): { h: number; m: number } {
      const t = new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'America/Santiago' });
      const [h, m] = t.split(':').map(Number);
      return { h, m };
    }

    async function collectSnapshot() {
      const todayStr = getCLTDate();
      const nowTime = getCLTTime();
      const { h, m } = getCLTHourMin();
      const totalMin = h * 60 + m;
      // Market hours: 09:30 – 16:00 CLT
      if (totalMin < 9 * 60 + 30 || totalMin >= 16 * 60) return;

      if (!(await ensureAuth())) return;

      try {
        const { data: holdings, error: hErr } = await workerClient
          .from('holdings')
          .select('ticker, shares');
        if (hErr || !holdings || holdings.length === 0) return;

        const prices = await Promise.all(
          holdings.map((h: any) => fetchStockFromYahooChart(h.ticker).catch(() => null))
        );

        let portfolioValue = 0;
        for (let i = 0; i < holdings.length; i++) {
          if (prices[i]?.price) portfolioValue += (holdings[i].shares ?? 0) * prices[i].price;
        }
        if (portfolioValue === 0) return;
        portfolioValue = Math.round(portfolioValue * 100) / 100;

        const now = Date.now();
        const snapshot: { time: string; timestamp: number; portfolioValue: number; ipsaValue: number } = {
          time: nowTime,
          timestamp: now,
          portfolioValue,
          ipsaValue: 0,
        };

        // Get existing snapshots for today
        const { data: existing } = await workerClient
          .from('intraday_snapshots')
          .select('data')
          .eq('user_id', workerUserId!)
          .eq('date', todayStr)
          .maybeSingle();

        let allSnapshots: any[] = existing?.data || [];

        // Avoid duplicate within 90s
        if (allSnapshots.some((s: any) => Math.abs(s.timestamp - now) < 90000)) return;

        allSnapshots.push(snapshot);
        allSnapshots.sort((a: any, b: any) => a.timestamp - b.timestamp);

        // Deduplicate by timestamp
        const unique = allSnapshots.filter((s: any, idx: number, arr: any[]) =>
          idx === 0 || Math.abs(s.timestamp - arr[idx - 1].timestamp) > 30000
        );

        await workerClient.from('intraday_snapshots').upsert(
          { user_id: workerUserId!, date: todayStr, data: unique },
          { onConflict: 'user_id,date' }
        );

        console.log(`[IntradayWorker] ${nowTime} → $${portfolioValue.toLocaleString('es-CL')} (${unique.length} pts)`);
      } catch (err: any) {
        console.error('[IntradayWorker] Error:', err?.message || err);
      }
    }

    // Give server a moment to start, then begin polling
    setTimeout(() => {
      collectSnapshot();
      setInterval(collectSnapshot, 3 * 60 * 1000);
      console.log('[IntradayWorker] Started — polling every 3 min 09:30–16:00 CLT');
    }, 5000);
  })();
  } catch (e: any) {
    console.error('[IntradayWorker] Init error:', e?.message || e);
  }

  // Graceful shutdown for Docker
  const shutdown = () => {
    console.log('Shutting down gracefully...');
    server.close(() => {
      console.log('Server closed.');
      process.exit(0);
    });
    setTimeout(() => {
      console.error('Forced shutdown after timeout');
      process.exit(1);
    }, 10000);
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

startServer();
