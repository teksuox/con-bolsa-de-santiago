/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { StockHolding, DividendPayment, TaxRefund, MarketStock, StockAlert } from './types';
import { normalizeTicker } from './utils';

export interface PriceHistoryRecord {
  ticker_date: string;
  ticker: string;
  date: string;
  close: number;
}

export interface DailySnapshot {
  date: string;
  portfolioValue: number;
}

export interface MonthlyPnLRecord {
  month: string;
  data: { date: string; portfolioValue: number; dailyPnL: number; dailyPnLPct: number }[];
}

const DB_NAME = 'BolsaSantiagoPortafolioDB';
const DB_VERSION = 6;

export interface DBBackupData {
  holdings: StockHolding[];
  dividends: DividendPayment[];
  refunds: TaxRefund[];
  annualPerformancePercent: number;
  customStocks?: MarketStock[];
  deletedTickers?: string[];
  investmentPlan?: { budget: number; allocations: { ticker: string; name: string; percent: number; inPlan: boolean; brokerPrice?: number; amount?: number }[] };
  dailySnapshots?: DailySnapshot[];
  alerts?: StockAlert[];
}

// Let's create an in-memory fallback if IndexedDB fails to initialize or operations fail
let useMemoryFallback = false;
const memoryStore: {
  holdings: any[];
  dividends: any[];
  refunds: any[];
  custom_stocks: any[];
  alerts: any[];
  settings: { [key: string]: any };
  monthly_pnl: any[];
  price_history: any[];
  daily_snapshots: any[];
} = {
  holdings: [],
  dividends: [],
  refunds: [],
  custom_stocks: [],
  alerts: [],
  settings: { annualPerformancePercent: 8.5 },
  monthly_pnl: [],
  price_history: [],
  daily_snapshots: []
};

let dbInstance: IDBDatabase | null = null;
let dbOpenPromise: Promise<IDBDatabase> | null = null;

export function initDB(): Promise<IDBDatabase> {
  if (dbInstance) {
    return Promise.resolve(dbInstance);
  }
  if (dbOpenPromise) {
    return dbOpenPromise;
  }

  dbOpenPromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      useMemoryFallback = true;
      reject(new Error('IndexedDB no está soportado o está bloqueado en este navegador.'));
      return;
    }

    try {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onerror = () => {
        dbOpenPromise = null;
        useMemoryFallback = true;
        reject(new Error('No se pudo abrir la base de datos local IndexedDB.'));
      };

      request.onsuccess = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;
        dbInstance = db;
        dbOpenPromise = null;

        db.onclose = () => {
          dbInstance = null;
        };
        db.onerror = () => {
          dbInstance = null;
        };

        resolve(db);
      };

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;
        
        // Create object stores
        if (!db.objectStoreNames.contains('holdings')) {
          db.createObjectStore('holdings', { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains('dividends')) {
          db.createObjectStore('dividends', { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains('refunds')) {
          db.createObjectStore('refunds', { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains('settings')) {
          db.createObjectStore('settings', { keyPath: 'key' });
        }
        if (!db.objectStoreNames.contains('custom_stocks')) {
          db.createObjectStore('custom_stocks', { keyPath: 'ticker' });
        }
        if (!db.objectStoreNames.contains('price_history')) {
          db.createObjectStore('price_history', { keyPath: 'ticker_date' });
        }
        if (!db.objectStoreNames.contains('daily_snapshots')) {
          db.createObjectStore('daily_snapshots', { keyPath: 'date' });
        }
        if (!db.objectStoreNames.contains('monthly_pnl')) {
          db.createObjectStore('monthly_pnl', { keyPath: 'month' });
        }
        if (!db.objectStoreNames.contains('alerts')) {
          db.createObjectStore('alerts', { keyPath: 'ticker' });
        }
      };
    } catch (e) {
      dbOpenPromise = null;
      useMemoryFallback = true;
      reject(new Error('Excepción al intentar abrir IndexedDB.'));
    }
  });

  return dbOpenPromise;
}

// Low level generic query support with memory fallback
function getStoreData<T>(storeName: string): Promise<T[]> {
  if (useMemoryFallback) {
    const list = (memoryStore as any)[storeName] || [];
    return Promise.resolve([...list]);
  }
  return initDB().then((db) => {
    return new Promise<T[]>((resolve, reject) => {
      try {
        const transaction = db.transaction(storeName, 'readonly');
        const store = transaction.objectStore(storeName);
        const request = store.getAll();

        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
        
        transaction.onerror = () => reject(transaction.error);
      } catch (err) {
        console.warn(`IndexedDB transaction failed for ${storeName}, switching to memory:`, err);
        useMemoryFallback = true;
        const list = (memoryStore as any)[storeName] || [];
        resolve([...list]);
      }
    });
  }).catch((err) => {
    console.warn(`IndexedDB init failed for ${storeName}, switching to memory:`, err);
    useMemoryFallback = true;
    const list = (memoryStore as any)[storeName] || [];
    return [...list];
  });
}

function findItemIndex(list: any[], storeName: string, item: any): number {
  return list.findIndex((x: any) => {
    if (storeName === 'custom_stocks') {
      return x.ticker === (item as any).ticker;
    }
    if (storeName === 'settings') {
      return x.key === (item as any).key;
    }
    if (storeName === 'monthly_pnl') {
      return x.month === (item as any).month;
    }
    return x.id === (item as any).id;
  });
}

function findItemIndexById(list: any[], storeName: string, id: any): number {
  return list.findIndex((x: any) => {
    if (storeName === 'custom_stocks') {
      return x.ticker === id;
    }
    return x.id === id;
  });
}

function saveStoreItem<T>(storeName: string, item: T): Promise<void> {
  if (useMemoryFallback) {
    const list = (memoryStore as any)[storeName];
    if (list) {
      const idx = findItemIndex(list, storeName, item);
      if (idx !== -1) {
        list[idx] = item;
      } else {
        list.push(item);
      }
    }
    return Promise.resolve();
  }
  return initDB().then((db) => {
    return new Promise<void>((resolve, reject) => {
      try {
        const transaction = db.transaction(storeName, 'readwrite');
        const store = transaction.objectStore(storeName);
        store.put(item);

        transaction.oncomplete = () => resolve();
        transaction.onerror = () => {
          console.warn(`Transaction error in saveStoreItem for ${storeName}`, transaction.error);
          reject(transaction.error);
        };
        transaction.onabort = () => {
          console.warn(`Transaction aborted in saveStoreItem for ${storeName}`);
          reject(new Error('Transaction aborted'));
        };
      } catch (err) {
        console.warn(`IndexedDB write failed for ${storeName}, switching to memory:`, err);
        useMemoryFallback = true;
        const list = (memoryStore as any)[storeName];
        if (list) {
          const idx = findItemIndex(list, storeName, item);
          if (idx !== -1) {
            list[idx] = item;
          } else {
            list.push(item);
          }
        }
        resolve();
      }
    });
  }).catch((err) => {
    console.warn(`IndexedDB connection write failed for ${storeName}, switching to memory:`, err);
    useMemoryFallback = true;
    const list = (memoryStore as any)[storeName];
    if (list) {
      const idx = findItemIndex(list, storeName, item);
      if (idx !== -1) {
        list[idx] = item;
      } else {
        list.push(item);
      }
    }
    return Promise.resolve();
  });
}

function deleteStoreItem(storeName: string, id: string | number): Promise<void> {
  if (useMemoryFallback) {
    const list = (memoryStore as any)[storeName];
    if (list) {
      const idx = findItemIndexById(list, storeName, id);
      if (idx !== -1) {
        list.splice(idx, 1);
      }
    }
    return Promise.resolve();
  }
  return initDB().then((db) => {
    return new Promise<void>((resolve, reject) => {
      try {
        const transaction = db.transaction(storeName, 'readwrite');
        const store = transaction.objectStore(storeName);
        store.delete(id);

        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error);
        transaction.onabort = () => reject(new Error('Transaction aborted'));
      } catch (err) {
        console.warn(`IndexedDB delete failed for ${storeName}, switching to memory:`, err);
        useMemoryFallback = true;
        const list = (memoryStore as any)[storeName];
        if (list) {
          const idx = findItemIndexById(list, storeName, id);
          if (idx !== -1) {
            list.splice(idx, 1);
          }
        }
        resolve();
      }
    });
  }).catch((err) => {
    console.warn(`IndexedDB delete connection failed for ${storeName}, switching to memory:`, err);
    useMemoryFallback = true;
    const list = (memoryStore as any)[storeName];
    if (list) {
      const idx = findItemIndexById(list, storeName, id);
      if (idx !== -1) {
        list.splice(idx, 1);
      }
    }
    return Promise.resolve();
  });
}

function clearStore(storeName: string): Promise<void> {
  if (useMemoryFallback) {
    if (storeName === 'settings') {
      memoryStore.settings = { annualPerformancePercent: 8.5 };
    } else {
      (memoryStore as any)[storeName] = [];
    }
    return Promise.resolve();
  }
  return initDB().then((db) => {
    return new Promise<void>((resolve, reject) => {
      try {
        const transaction = db.transaction(storeName, 'readwrite');
        const store = transaction.objectStore(storeName);
        store.clear();

        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error);
        transaction.onabort = () => reject(new Error('Transaction aborted'));
      } catch (err) {
        console.warn(`IndexedDB clear failed for ${storeName}, switching to memory:`, err);
        useMemoryFallback = true;
        if (storeName === 'settings') {
          memoryStore.settings = { annualPerformancePercent: 8.5 };
        } else {
          (memoryStore as any)[storeName] = [];
        }
        resolve();
      }
    });
  }).catch((err) => {
    console.warn(`IndexedDB clear connection failed for ${storeName}, switching to memory:`, err);
    useMemoryFallback = true;
    if (storeName === 'settings') {
      memoryStore.settings = { annualPerformancePercent: 8.5 };
    } else {
      (memoryStore as any)[storeName] = [];
    }
    return Promise.resolve();
  });
}

// Structured App Methods
export const portafolioDB = {
  // Holdings
  getHoldings(): Promise<StockHolding[]> {
    return getStoreData<StockHolding>('holdings');
  },
  saveHolding(holding: StockHolding): Promise<void> {
    return saveStoreItem<StockHolding>('holdings', { ...holding, updatedAt: new Date().toISOString() });
  },
  deleteHolding(id: string): Promise<void> {
    return deleteStoreItem('holdings', id);
  },

  // Dividends
  getDividends(): Promise<DividendPayment[]> {
    return getStoreData<DividendPayment>('dividends');
  },
  saveDividend(dividend: DividendPayment): Promise<void> {
    return saveStoreItem<DividendPayment>('dividends', { ...dividend, updatedAt: new Date().toISOString() });
  },
  deleteDividend(id: string): Promise<void> {
    return deleteStoreItem('dividends', id);
  },

  // Tax Refunds
  getRefunds(): Promise<TaxRefund[]> {
    return getStoreData<TaxRefund>('refunds');
  },
  saveRefund(refund: TaxRefund): Promise<void> {
    return saveStoreItem<TaxRefund>('refunds', { ...refund, updatedAt: new Date().toISOString() });
  },
  deleteRefund(id: string): Promise<void> {
    return deleteStoreItem('refunds', id);
  },

  // Custom Stocks (save & retrieve search results and ETFs)
  getCustomStocks(): Promise<MarketStock[]> {
    return getStoreData<MarketStock>('custom_stocks');
  },
  saveCustomStock(stock: MarketStock): Promise<void> {
    return saveStoreItem<MarketStock>('custom_stocks', stock);
  },
  deleteCustomStock(ticker: string): Promise<void> {
    return deleteStoreItem('custom_stocks', ticker);
  },

  // Alerts
  getAlerts(): Promise<StockAlert[]> {
    return getStoreData<StockAlert>('alerts');
  },
  saveAlert(alert: StockAlert): Promise<void> {
    return saveStoreItem<StockAlert>('alerts', { ...alert, updatedAt: new Date().toISOString() });
  },
  deleteAlert(ticker: string): Promise<void> {
    return deleteStoreItem('alerts', ticker);
  },

  // Generic settings helper
  async getSetting(key: string): Promise<any> {
    if (useMemoryFallback) {
      return memoryStore.settings[key] ?? null;
    }
    try {
      const db = await initDB();
      return new Promise<any>((resolve) => {
        try {
          const transaction = db.transaction('settings', 'readonly');
          const store = transaction.objectStore('settings');
          const request = store.get(key);
          request.onsuccess = () => resolve(request.result?.value ?? null);
          request.onerror = () => resolve(null);
          transaction.onerror = () => resolve(null);
        } catch {
          useMemoryFallback = true;
          resolve(memoryStore.settings[key] ?? null);
        }
      });
    } catch {
      return memoryStore.settings[key] ?? null;
    }
  },
  async saveSetting(key: string, value: any): Promise<void> {
    if (useMemoryFallback) {
      memoryStore.settings[key] = value;
      return;
    }
    try {
      const db = await initDB();
      return new Promise<void>((resolve, reject) => {
        try {
          const transaction = db.transaction('settings', 'readwrite');
          const store = transaction.objectStore('settings');
          store.put({ key, value });
          transaction.oncomplete = () => resolve();
          transaction.onerror = () => reject(transaction.error);
        } catch {
          useMemoryFallback = true;
          memoryStore.settings[key] = value;
          resolve();
        }
      });
    } catch {
      memoryStore.settings[key] = value;
    }
  },

  // Investment Plan
  async getInvestmentPlan(): Promise<{ budget: number; allocations: any[] } | null> {
    return this.getSetting('investmentPlan');
  },
  async saveInvestmentPlan(plan: { budget: number; allocations: any[] }): Promise<void> {
    return this.saveSetting('investmentPlan', plan);
  },

  // Settings
  async getAnnualYield(): Promise<number> {
    if (useMemoryFallback) {
      return Promise.resolve(memoryStore.settings.annualPerformancePercent || 8.5);
    }
    try {
      const db = await initDB();
      return new Promise<number>((resolve) => {
        try {
          const transaction = db.transaction('settings', 'readonly');
          const store = transaction.objectStore('settings');
          const request = store.get('annualPerformancePercent');

          request.onsuccess = () => {
            if (request.result) {
              resolve(request.result.value);
            } else {
              resolve(8.5); // default fallback
            }
          };
          request.onerror = () => {
            resolve(8.5);
          };
          transaction.onerror = () => {
            resolve(8.5);
          };
        } catch (err) {
          console.warn('getAnnualYield transaction failed, switching to memory:', err);
          useMemoryFallback = true;
          resolve(memoryStore.settings.annualPerformancePercent || 8.5);
        }
      });
    } catch (err) {
      console.warn('getAnnualYield connection failed, switching to memory:', err);
      useMemoryFallback = true;
      return memoryStore.settings.annualPerformancePercent || 8.5;
    }
  },

  async saveAnnualYield(value: number): Promise<void> {
    if (useMemoryFallback) {
      memoryStore.settings.annualPerformancePercent = value;
      return Promise.resolve();
    }
    try {
      const db = await initDB();
      return new Promise<void>((resolve, reject) => {
        try {
          const transaction = db.transaction('settings', 'readwrite');
          const store = transaction.objectStore('settings');
          store.put({ key: 'annualPerformancePercent', value });

          transaction.oncomplete = () => resolve();
          transaction.onerror = () => reject(transaction.error);
          transaction.onabort = () => reject(new Error('Transaction aborted'));
        } catch (err) {
          console.warn('saveAnnualYield transaction failed, switching to memory:', err);
          useMemoryFallback = true;
          memoryStore.settings.annualPerformancePercent = value;
          resolve();
        }
      });
    } catch (err) {
      console.warn('saveAnnualYield connection failed, switching to memory:', err);
      useMemoryFallback = true;
      memoryStore.settings.annualPerformancePercent = value;
      return Promise.resolve();
    }
  },

  async getDeletedTickers(): Promise<string[]> {
    if (useMemoryFallback) {
      return Promise.resolve(memoryStore.settings.deletedTickers || []);
    }
    try {
      const db = await initDB();
      return new Promise<string[]>((resolve) => {
        try {
          const transaction = db.transaction('settings', 'readonly');
          const store = transaction.objectStore('settings');
          const request = store.get('deletedTickers');

          request.onsuccess = () => {
            if (request.result) {
              resolve(request.result.value || []);
            } else {
              resolve([]);
            }
          };
          request.onerror = () => {
            resolve([]);
          };
          transaction.onerror = () => {
            resolve([]);
          };
        } catch (err) {
          console.warn('getDeletedTickers transaction failed, switching to memory:', err);
          useMemoryFallback = true;
          resolve(memoryStore.settings.deletedTickers || []);
        }
      });
    } catch (err) {
      console.warn('getDeletedTickers connection failed, switching to memory:', err);
      useMemoryFallback = true;
      return memoryStore.settings.deletedTickers || [];
    }
  },

  async saveDeletedTickers(tickers: string[]): Promise<void> {
    if (useMemoryFallback) {
      memoryStore.settings.deletedTickers = tickers;
      return Promise.resolve();
    }
    try {
      const db = await initDB();
      return new Promise<void>((resolve, reject) => {
        try {
          const transaction = db.transaction('settings', 'readwrite');
          const store = transaction.objectStore('settings');
          store.put({ key: 'deletedTickers', value: tickers });

          transaction.oncomplete = () => resolve();
          transaction.onerror = () => reject(transaction.error);
          transaction.onabort = () => reject(new Error('Transaction aborted'));
        } catch (err) {
          console.warn('saveDeletedTickers transaction failed, switching to memory:', err);
          useMemoryFallback = true;
          memoryStore.settings.deletedTickers = tickers;
          resolve();
        }
      });
    } catch (err) {
      console.warn('saveDeletedTickers connection failed, switching to memory:', err);
      useMemoryFallback = true;
      memoryStore.settings.deletedTickers = tickers;
      return Promise.resolve();
    }
  },

  // Price History
  async getPriceHistory(ticker: string): Promise<PriceHistoryRecord[]> {
    if (useMemoryFallback) return [];
    try {
      const db = await initDB();
      return new Promise<PriceHistoryRecord[]>((resolve, reject) => {
        try {
          const transaction = db.transaction('price_history', 'readonly');
          const store = transaction.objectStore('price_history');
          const range = IDBKeyRange.bound(`${ticker}_`, `${ticker}_\uffff`);
          const request = store.getAll(range);
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
        } catch (err) {
          console.warn('getPriceHistory transaction failed:', err);
          resolve([]);
        }
      });
    } catch {
      return [];
    }
  },
  async savePriceHistory(records: PriceHistoryRecord[]): Promise<void> {
    if (useMemoryFallback || records.length === 0) return;
    try {
      const db = await initDB();
      return new Promise<void>((resolve, reject) => {
        try {
          const transaction = db.transaction('price_history', 'readwrite');
          const store = transaction.objectStore('price_history');
          for (const r of records) store.put(r);
          transaction.oncomplete = () => resolve();
          transaction.onerror = () => reject(transaction.error);
        } catch (err) {
          console.warn('savePriceHistory transaction failed:', err);
          resolve();
        }
      });
    } catch {
      // silently fail
    }
  },

  // Daily Snapshots
  async getDailySnapshots(): Promise<DailySnapshot[]> {
    return getStoreData<DailySnapshot>('daily_snapshots');
  },
  async saveDailySnapshot(snapshot: DailySnapshot): Promise<void> {
    return saveStoreItem<DailySnapshot>('daily_snapshots', snapshot);
  },

  // Monthly P&L
  async getMonthlyPnL(months: string[]): Promise<Record<string, MonthlyPnLRecord['data']>> {
    const all = await getStoreData<MonthlyPnLRecord>('monthly_pnl');
    const result: Record<string, MonthlyPnLRecord['data']> = {};
    for (const m of all) {
      if (months.includes(m.month)) {
        result[m.month] = m.data;
      }
    }
    return result;
  },
  async saveMonthlyPnL(month: string, data: MonthlyPnLRecord['data']): Promise<void> {
    return saveStoreItem<MonthlyPnLRecord>('monthly_pnl', { month, data });
  },
  async getLatestMonthlyPnLDate(): Promise<string | null> {
    const all = await getStoreData<MonthlyPnLRecord>('monthly_pnl');
    let latest: string | null = null;
    for (const m of all) {
      for (const entry of m.data) {
        if (!latest || entry.date > latest) {
          latest = entry.date;
        }
      }
    }
    return latest;
  },
  async getAllMonthlyPnL(): Promise<MonthlyPnLRecord[]> {
    return getStoreData<MonthlyPnLRecord>('monthly_pnl');
  },

  // EXPORT ALL DATA
  async exportBackup(): Promise<DBBackupData> {
    const holdings = await this.getHoldings();
    const dividends = await this.getDividends();
    const refunds = await this.getRefunds();
    const annualPerformancePercent = await this.getAnnualYield();
    const customStocks = await this.getCustomStocks();
    const deletedTickers = await this.getDeletedTickers();
    const dailySnapshots = await this.getDailySnapshots();
    const alerts = await this.getAlerts();
    const investmentPlan = await this.getInvestmentPlan();

    return {
      holdings,
      dividends,
      refunds,
      annualPerformancePercent,
      customStocks,
      deletedTickers,
      investmentPlan: investmentPlan || undefined,
      dailySnapshots,
      alerts
    };
  },

  // IMPORT ALL DATA (RESTORE)
  async importBackup(data: any): Promise<void> {
    if (!data || typeof data !== 'object') {
      throw new Error('Formato de datos de respaldo inválido.');
    }

    // Basic structural validation
    const holdings = Array.isArray(data.holdings) ? data.holdings : [];
    const dividends = Array.isArray(data.dividends) ? data.dividends : [];
    const refunds = Array.isArray(data.refunds) ? data.refunds : [];
    const yieldValue = typeof data.annualPerformancePercent === 'number' ? data.annualPerformancePercent : 8.5;
    const customStocks = Array.isArray(data.customStocks) ? data.customStocks : [];
    const deletedTickers = Array.isArray(data.deletedTickers) ? data.deletedTickers : [];

    // Clear stores
    await clearStore('holdings');
    await clearStore('dividends');
    await clearStore('refunds');
    await clearStore('settings');
    await clearStore('custom_stocks');
    await clearStore('alerts');
    await clearStore('daily_snapshots');
    await clearStore('price_history');

    // Populate stores
    for (const h of holdings) {
      if (h.id && h.ticker) await this.saveHolding(h);
    }
    for (const d of dividends) {
      if (d.id && d.ticker) await this.saveDividend(d);
    }
    for (const r of refunds) {
      if (r.id && r.year) await this.saveRefund(r);
    }
    const seenTickers = new Set<string>();
    for (const s of customStocks) {
      if (s.ticker) {
        const normalized = normalizeTicker(s.ticker);
        const stock = { ...s, ticker: normalized };
        if (!seenTickers.has(normalized)) {
          seenTickers.add(normalized);
          await this.saveCustomStock(stock);
        }
      }
    }
    const seenDeleted = new Set<string>();
    for (const t of deletedTickers) {
      const normalized = normalizeTicker(t);
      if (!seenDeleted.has(normalized)) {
        seenDeleted.add(normalized);
      }
    }
    if (data.investmentPlan) {
      await this.saveInvestmentPlan({
        budget: data.investmentPlan.budget ?? 1000000,
        allocations: data.investmentPlan.allocations ?? []
      });
    }

    if (Array.isArray(data.alerts)) {
      await clearStore('alerts');
      for (const a of data.alerts) {
        if (a.ticker) await this.saveAlert(a);
      }
    }

    const snapshots = Array.isArray(data.dailySnapshots) ? data.dailySnapshots : [];
    for (const s of snapshots) {
      if (s.date && typeof s.portfolioValue === 'number') {
        await this.saveDailySnapshot(s);
      }
    }

    await this.saveAnnualYield(yieldValue);
    await this.saveDeletedTickers(Array.from(seenDeleted));
  },

  // TRUNCATE DEMO DATA
  async clearAllData(): Promise<void> {
    await clearStore('holdings');
    await clearStore('dividends');
    await clearStore('refunds');
    await clearStore('custom_stocks');
    await clearStore('alerts');
    await clearStore('settings');
    await clearStore('daily_snapshots');
    await clearStore('price_history');
    await clearStore('monthly_pnl');
    await this.saveAnnualYield(8.5);
    await this.saveDeletedTickers([]);
  }
};
