export type Side = 'Buy' | 'Sell';
export type TradeStatus = 'Filled' | 'Partial' | 'Working' | 'Cancelled' | 'Rejected';

export interface Trade {
  id: number;
  symbol: string;
  name: string;
  sector: string;
  region: string;
  side: Side;
  qty: number;
  price: number;
  notional: number;
  pnl: number;
  status: TradeStatus;
  /** Epoch ms. Numbers are far cheaper than Date objects at millions of rows. */
  tradeDate: number;
  trader: string;
  account: string;
  fillPct: number;
}

const SYMBOLS: [string, string, string][] = [
  ['AAPL', 'Apple Inc.', 'Technology'],
  ['MSFT', 'Microsoft Corp.', 'Technology'],
  ['NVDA', 'NVIDIA Corp.', 'Technology'],
  ['AMZN', 'Amazon.com Inc.', 'Consumer'],
  ['TSLA', 'Tesla Inc.', 'Consumer'],
  ['JPM', 'JPMorgan Chase', 'Financials'],
  ['GS', 'Goldman Sachs', 'Financials'],
  ['BAC', 'Bank of America', 'Financials'],
  ['XOM', 'Exxon Mobil', 'Energy'],
  ['CVX', 'Chevron Corp.', 'Energy'],
  ['PFE', 'Pfizer Inc.', 'Healthcare'],
  ['JNJ', 'Johnson & Johnson', 'Healthcare'],
  ['UNH', 'UnitedHealth Group', 'Healthcare'],
  ['BA', 'Boeing Co.', 'Industrials'],
  ['CAT', 'Caterpillar Inc.', 'Industrials'],
  ['KO', 'Coca-Cola Co.', 'Staples'],
  ['PG', 'Procter & Gamble', 'Staples'],
  ['NEE', 'NextEra Energy', 'Utilities'],
  ['PLD', 'Prologis Inc.', 'Real Estate'],
  ['LIN', 'Linde plc', 'Materials'],
];
const REGIONS = ['Americas', 'EMEA', 'APAC'];
const STATUSES: TradeStatus[] = ['Filled', 'Filled', 'Filled', 'Partial', 'Working', 'Cancelled', 'Rejected'];
const TRADERS = ['A. Patel', 'B. Nguyen', 'C. Okafor', 'D. Schmidt', 'E. Rossi', 'F. Tanaka', 'G. Haddad', 'H. Larsen'];
const ACCOUNTS = ['Core Equity', 'Growth', 'Income', 'Hedge Overlay', 'Index Tracker', 'Global Macro'];

/** Small deterministic PRNG so every reload shows the same data. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function generateTrades(count: number, seed = 42): Trade[] {
  const rnd = mulberry32(seed);
  const pick = <T>(arr: readonly T[]): T => arr[Math.floor(rnd() * arr.length)];
  const start = Date.UTC(2024, 0, 1);
  const span = Date.UTC(2026, 10, 1) - start;
  const out: Trade[] = new Array(count);
  for (let i = 0; i < count; i++) {
    const [symbol, name, sector] = pick(SYMBOLS);
    const side: Side = rnd() < 0.52 ? 'Buy' : 'Sell';
    const qty = Math.round(50 + rnd() * 9950);
    const price = Math.round((5 + rnd() * 995) * 100) / 100;
    const notional = Math.round(qty * price * 100) / 100;
    const status = pick(STATUSES);
    out[i] = {
      id: i + 1,
      symbol,
      name,
      sector,
      region: pick(REGIONS),
      side,
      qty,
      price,
      notional,
      pnl: Math.round((rnd() - 0.48) * notional * 0.05 * 100) / 100,
      status,
      tradeDate: start + Math.floor(rnd() * span),
      trader: pick(TRADERS),
      account: pick(ACCOUNTS),
      fillPct: status === 'Filled' ? 100 : status === 'Partial' ? Math.round(rnd() * 90) + 5 : 0,
    };
  }
  return out;
}
