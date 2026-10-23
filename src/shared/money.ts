/** Money is stored in USD everywhere. These helpers convert and format for the display currency. */

export const CURRENCIES = ['USD', 'GBP', 'EUR', 'CAD', 'AUD', 'NZD', 'CHF', 'SEK', 'NOK', 'DKK', 'JPY', 'INR', 'BRL'] as const;

/** Only used until live rates have been fetched, or when offline. */
export const FALLBACK_RATES: Record<string, number> = { USD: 1, GBP: 0.75, EUR: 0.86, CAD: 1.38, AUD: 1.52, NZD: 1.68, CHF: 0.8, SEK: 9.5, NOK: 10, DKK: 6.4, JPY: 150, INR: 84, BRL: 5.5 };

export const rateFor = (currency: string, rates?: Record<string, number>) => (rates && rates[currency]) || FALLBACK_RATES[currency] || 1;
export const toDisplay = (usd: number, currency: string, rates?: Record<string, number>) => usd * rateFor(currency, rates);
export const fromDisplay = (amount: number, currency: string, rates?: Record<string, number>) => amount / rateFor(currency, rates);

export function currencySymbol(currency: string): string {
  try {
    return new Intl.NumberFormat('en-GB', { style: 'currency', currency, currencyDisplay: 'narrowSymbol' }).formatToParts(0).find((p) => p.type === 'currency')?.value || currency;
  } catch { return currency; }
}

/** `whole` drops the decimals for round amounts such as caps (£40 rather than £40.00). */
export function fmtMoney(usd: number, currency: string, rates?: Record<string, number>, opts: { whole?: boolean } = {}): string {
  const v = toDisplay(usd, currency, rates);
  const zero = currency === 'JPY';
  const whole = zero || (opts.whole && Math.abs(v - Math.round(v)) < 0.005);
  try {
    return new Intl.NumberFormat('en-GB', { style: 'currency', currency, currencyDisplay: 'narrowSymbol', minimumFractionDigits: whole ? 0 : 2, maximumFractionDigits: whole ? 0 : 2 }).format(v);
  } catch { return `${currency} ${v.toFixed(2)}`; }
}

const REGION_CURRENCY: Record<string, string> = {
  GB: 'GBP', US: 'USD', CA: 'CAD', AU: 'AUD', NZ: 'NZD', CH: 'CHF', SE: 'SEK', NO: 'NOK', DK: 'DKK', JP: 'JPY', IN: 'INR', BR: 'BRL',
  IE: 'EUR', DE: 'EUR', FR: 'EUR', ES: 'EUR', IT: 'EUR', NL: 'EUR', BE: 'EUR', AT: 'EUR', PT: 'EUR', FI: 'EUR', GR: 'EUR'
};
export const currencyForRegion = (region?: string) => (region && REGION_CURRENCY[region.toUpperCase()]) || null;
