export interface IntradayPoint {
  time: string;
  timestamp: number;
  portfolioValue: number;
  ipsaValue: number;
}

function getTodayKey(): string {
  const d = new Date();
  return d.toLocaleDateString('en-CA', { timeZone: 'America/Santiago' });
}

export function loadIntradaySnapshots(): IntradayPoint[] {
  try {
    const raw = localStorage.getItem('intraday_' + getTodayKey());
    if (raw) {
      const data = JSON.parse(raw);
      if (Array.isArray(data)) return data as IntradayPoint[];
    }
  } catch {}
  return [];
}

export function saveIntradaySnapshot(point: IntradayPoint): void {
  try {
    const todayKey = 'intraday_' + getTodayKey();
    // Clean up any keys from previous days
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith('intraday_') && key !== todayKey) {
        localStorage.removeItem(key);
      }
    }
    const existing = loadIntradaySnapshots();
    const last = existing[existing.length - 1];
    if (last && (point.timestamp - last.timestamp) < 120000) {
      existing[existing.length - 1] = point;
    } else {
      existing.push(point);
    }
    localStorage.setItem(todayKey, JSON.stringify(existing));
    if (existing.length > 200) {
      localStorage.setItem(todayKey, JSON.stringify(existing.slice(-200)));
    }
  } catch {}
}

export function clearIntradaySnapshots(): void {
  try {
    localStorage.removeItem('intraday_' + getTodayKey());
  } catch {}
}
