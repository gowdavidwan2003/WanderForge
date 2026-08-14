/**
 * Currency inference and formatting.
 *
 * Trips previously stored whatever the wizard dropdown defaulted to (USD), so an
 * itinerary for Chikmagaluru rendered "USD 100" for a ₹100 breakfast. Currency is
 * now inferred from the destination up front and confirmed by the AI's own
 * `currency` field once an itinerary is generated.
 */

export const CURRENCIES = {
  USD: { symbol: '$', label: 'US Dollar' },
  EUR: { symbol: '€', label: 'Euro' },
  GBP: { symbol: '£', label: 'British Pound' },
  INR: { symbol: '₹', label: 'Indian Rupee' },
  JPY: { symbol: '¥', label: 'Japanese Yen' },
  AUD: { symbol: 'A$', label: 'Australian Dollar' },
  CAD: { symbol: 'C$', label: 'Canadian Dollar' },
  SGD: { symbol: 'S$', label: 'Singapore Dollar' },
  AED: { symbol: 'AED', label: 'UAE Dirham' },
  THB: { symbol: '฿', label: 'Thai Baht' },
  IDR: { symbol: 'Rp', label: 'Indonesian Rupiah' },
  MYR: { symbol: 'RM', label: 'Malaysian Ringgit' },
  CHF: { symbol: 'CHF', label: 'Swiss Franc' },
  CNY: { symbol: '¥', label: 'Chinese Yuan' },
  KRW: { symbol: '₩', label: 'South Korean Won' },
  VND: { symbol: '₫', label: 'Vietnamese Dong' },
  LKR: { symbol: 'Rs', label: 'Sri Lankan Rupee' },
  NPR: { symbol: 'Rs', label: 'Nepalese Rupee' },
  ZAR: { symbol: 'R', label: 'South African Rand' },
  BRL: { symbol: 'R$', label: 'Brazilian Real' },
  MXN: { symbol: 'MX$', label: 'Mexican Peso' },
  TRY: { symbol: '₺', label: 'Turkish Lira' },
  EGP: { symbol: 'E£', label: 'Egyptian Pound' },
  MAD: { symbol: 'MAD', label: 'Moroccan Dirham' },
  NZD: { symbol: 'NZ$', label: 'New Zealand Dollar' },
  PHP: { symbol: '₱', label: 'Philippine Peso' },
  RUB: { symbol: '₽', label: 'Russian Ruble' },
  SEK: { symbol: 'kr', label: 'Swedish Krona' },
  NOK: { symbol: 'kr', label: 'Norwegian Krone' },
  DKK: { symbol: 'kr', label: 'Danish Krone' },
  PLN: { symbol: 'zł', label: 'Polish Zloty' },
  CZK: { symbol: 'Kč', label: 'Czech Koruna' },
  HUF: { symbol: 'Ft', label: 'Hungarian Forint' },
  ISK: { symbol: 'kr', label: 'Icelandic Krona' },
  PEN: { symbol: 'S/', label: 'Peruvian Sol' },
  ARS: { symbol: 'AR$', label: 'Argentine Peso' },
  CLP: { symbol: 'CLP$', label: 'Chilean Peso' },
  KES: { symbol: 'KSh', label: 'Kenyan Shilling' },
  TZS: { symbol: 'TSh', label: 'Tanzanian Shilling' },
  QAR: { symbol: 'QAR', label: 'Qatari Riyal' },
  SAR: { symbol: 'SAR', label: 'Saudi Riyal' },
  ILS: { symbol: '₪', label: 'Israeli Shekel' },
  HKD: { symbol: 'HK$', label: 'Hong Kong Dollar' },
  TWD: { symbol: 'NT$', label: 'Taiwan Dollar' },
  CUP: { symbol: 'CUP', label: 'Cuban Peso' },
};

// Matched against the destination string, longest/most-specific first.
const PLACE_TO_CURRENCY = [
  ['india', 'INR'], ['bengaluru', 'INR'], ['bangalore', 'INR'], ['mumbai', 'INR'],
  ['delhi', 'INR'], ['jaipur', 'INR'], ['goa', 'INR'], ['kerala', 'INR'],
  ['karnataka', 'INR'], ['chikmagaluru', 'INR'], ['chikkamagaluru', 'INR'],
  ['coorg', 'INR'], ['ooty', 'INR'], ['manali', 'INR'], ['ladakh', 'INR'],
  ['rishikesh', 'INR'], ['varanasi', 'INR'], ['agra', 'INR'], ['udaipur', 'INR'],
  ['chennai', 'INR'], ['hyderabad', 'INR'], ['kolkata', 'INR'], ['pune', 'INR'],
  ['mysore', 'INR'], ['mysuru', 'INR'], ['hampi', 'INR'], ['shimla', 'INR'],

  ['japan', 'JPY'], ['tokyo', 'JPY'], ['kyoto', 'JPY'], ['osaka', 'JPY'],
  ['united kingdom', 'GBP'], ['england', 'GBP'], ['london', 'GBP'], ['scotland', 'GBP'],
  ['edinburgh', 'GBP'], ['wales', 'GBP'],
  ['united states', 'USD'], ['usa', 'USD'], ['new york', 'USD'], ['los angeles', 'USD'],
  ['san francisco', 'USD'], ['chicago', 'USD'], ['hawaii', 'USD'], ['miami', 'USD'],
  ['las vegas', 'USD'], ['boston', 'USD'], ['seattle', 'USD'],

  ['france', 'EUR'], ['paris', 'EUR'], ['nice', 'EUR'], ['italy', 'EUR'],
  ['rome', 'EUR'], ['venice', 'EUR'], ['florence', 'EUR'], ['milan', 'EUR'],
  ['spain', 'EUR'], ['barcelona', 'EUR'], ['madrid', 'EUR'], ['seville', 'EUR'],
  ['germany', 'EUR'], ['berlin', 'EUR'], ['munich', 'EUR'], ['netherlands', 'EUR'],
  ['amsterdam', 'EUR'], ['portugal', 'EUR'], ['lisbon', 'EUR'], ['porto', 'EUR'],
  ['greece', 'EUR'], ['athens', 'EUR'], ['santorini', 'EUR'], ['mykonos', 'EUR'],
  ['austria', 'EUR'], ['vienna', 'EUR'], ['ireland', 'EUR'], ['dublin', 'EUR'],
  ['belgium', 'EUR'], ['brussels', 'EUR'], ['finland', 'EUR'], ['helsinki', 'EUR'],
  ['croatia', 'EUR'], ['estonia', 'EUR'], ['slovenia', 'EUR'], ['malta', 'EUR'],

  ['australia', 'AUD'], ['sydney', 'AUD'], ['melbourne', 'AUD'], ['brisbane', 'AUD'],
  ['canada', 'CAD'], ['toronto', 'CAD'], ['vancouver', 'CAD'], ['montreal', 'CAD'],
  ['singapore', 'SGD'],
  ['dubai', 'AED'], ['abu dhabi', 'AED'], ['uae', 'AED'], ['emirates', 'AED'],
  ['thailand', 'THB'], ['bangkok', 'THB'], ['phuket', 'THB'], ['chiang mai', 'THB'],
  ['indonesia', 'IDR'], ['bali', 'IDR'], ['jakarta', 'IDR'],
  ['malaysia', 'MYR'], ['kuala lumpur', 'MYR'],
  ['switzerland', 'CHF'], ['zurich', 'CHF'], ['geneva', 'CHF'], ['interlaken', 'CHF'],
  ['china', 'CNY'], ['beijing', 'CNY'], ['shanghai', 'CNY'],
  ['south korea', 'KRW'], ['korea', 'KRW'], ['seoul', 'KRW'], ['busan', 'KRW'],
  ['vietnam', 'VND'], ['hanoi', 'VND'], ['ho chi minh', 'VND'],
  ['sri lanka', 'LKR'], ['colombo', 'LKR'],
  ['nepal', 'NPR'], ['kathmandu', 'NPR'], ['pokhara', 'NPR'],
  ['south africa', 'ZAR'], ['cape town', 'ZAR'], ['johannesburg', 'ZAR'],
  ['brazil', 'BRL'], ['rio de janeiro', 'BRL'], ['sao paulo', 'BRL'],
  ['mexico', 'MXN'], ['cancun', 'MXN'], ['mexico city', 'MXN'],
  ['turkey', 'TRY'], ['istanbul', 'TRY'], ['cappadocia', 'TRY'],
  ['egypt', 'EGP'], ['cairo', 'EGP'], ['luxor', 'EGP'],
  ['morocco', 'MAD'], ['marrakech', 'MAD'], ['casablanca', 'MAD'],
  ['new zealand', 'NZD'], ['queenstown', 'NZD'], ['auckland', 'NZD'],
  ['philippines', 'PHP'], ['manila', 'PHP'], ['cebu', 'PHP'],
  ['russia', 'RUB'], ['moscow', 'RUB'],
  ['sweden', 'SEK'], ['stockholm', 'SEK'],
  ['norway', 'NOK'], ['oslo', 'NOK'], ['bergen', 'NOK'],
  ['denmark', 'DKK'], ['copenhagen', 'DKK'],
  ['poland', 'PLN'], ['krakow', 'PLN'], ['warsaw', 'PLN'],
  ['czech', 'CZK'], ['prague', 'CZK'],
  ['hungary', 'HUF'], ['budapest', 'HUF'],
  ['iceland', 'ISK'], ['reykjavik', 'ISK'],
  ['peru', 'PEN'], ['cusco', 'PEN'], ['lima', 'PEN'],
  ['argentina', 'ARS'], ['buenos aires', 'ARS'],
  ['chile', 'CLP'], ['santiago', 'CLP'],
  ['kenya', 'KES'], ['nairobi', 'KES'],
  ['tanzania', 'TZS'], ['zanzibar', 'TZS'],
  ['qatar', 'QAR'], ['doha', 'QAR'],
  ['saudi', 'SAR'], ['riyadh', 'SAR'],
  ['israel', 'ILS'], ['jerusalem', 'ILS'], ['tel aviv', 'ILS'],
  ['hong kong', 'HKD'], ['taiwan', 'TWD'], ['taipei', 'TWD'],
  ['cuba', 'CUP'], ['havana', 'CUP'],
  ['maldives', 'USD'],
];

/**
 * Best-effort currency for a destination string. Returns null when unknown, so
 * callers can fall back rather than silently mislabelling amounts.
 */
export function inferCurrency(destination) {
  if (!destination) return null;
  const q = destination.toLowerCase();

  // Longest match wins: "new zealand" must beat "zealand"-style partial hits.
  let best = null;
  for (const [place, code] of PLACE_TO_CURRENCY) {
    if (q.includes(place) && (!best || place.length > best.place.length)) {
      best = { place, code };
    }
  }
  return best?.code ?? null;
}

export function currencySymbol(code) {
  return CURRENCIES[code]?.symbol ?? code ?? '';
}

/** Format an amount for display, e.g. formatMoney(1500, 'INR') -> "₹1,500". */
export function formatMoney(amount, code, { decimals = 0 } = {}) {
  const value = Number(amount) || 0;
  const symbol = currencySymbol(code);
  const formatted = value.toLocaleString(undefined, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
  // Codes without a distinct glyph read better with a space: "AED 400", "₹400".
  return /^[A-Z]{2,4}\$?$/.test(symbol) ? `${symbol} ${formatted}` : `${symbol}${formatted}`;
}
