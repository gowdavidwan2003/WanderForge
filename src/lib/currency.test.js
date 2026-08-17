import { describe, expect, it } from 'vitest';
import { CURRENCIES, currencySymbol, formatMoney, inferCurrency } from '@/lib/currency';

describe('inferCurrency — the substring collision', () => {
  // The reported symptom: US destinations billing in rupees. inferCurrency asked
  // whether the destination *contained* each place name, so "india" matched
  // inside "Indiana" — and since the longest hit won, "india" (5) even beat
  // "usa" (3) in a string that named the country outright.
  it('does not read "india" out of "Indiana"', () => {
    expect(inferCurrency('Indianapolis, Indiana')).toBe('USD');
    expect(inferCurrency('Indiana, USA')).toBe('USD');
    expect(inferCurrency('Indiana')).toBe('USD');
  });

  it('still resolves India itself', () => {
    expect(inferCurrency('India')).toBe('INR');
    expect(inferCurrency('Goa, India')).toBe('INR');
    expect(inferCurrency('New Delhi, India')).toBe('INR');
  });

  it('matches whole words, so a place name inside a longer word does not count', () => {
    // 'usa' sits inside Jerusalem, Busan and Kusadasi; 'nice' inside Venice;
    // 'china' inside Chinatown. None should decide the currency.
    expect(inferCurrency('Jerusalem')).toBe('ILS');
    expect(inferCurrency('Busan')).toBe('KRW');
    expect(inferCurrency('Kusadasi, Turkey')).toBe('TRY');
    expect(inferCurrency('Venice, Italy')).toBe('EUR');
    expect(inferCurrency('Chinatown, San Francisco')).toBe('USD');
  });
});

describe('inferCurrency — ambiguous names', () => {
  // Not a matching bug: Lima really is in both Peru and Ohio. The surrounding
  // region decides, because a region is the more authoritative signal.
  it('lets the region settle a city that exists in two countries', () => {
    expect(inferCurrency('Lima, Peru')).toBe('PEN');
    expect(inferCurrency('Lima, Ohio')).toBe('USD');
    expect(inferCurrency('Santiago, Chile')).toBe('CLP');
  });

  it('prefers the longer multi-word place over a shorter one inside it', () => {
    expect(inferCurrency('New Zealand')).toBe('NZD');
    expect(inferCurrency('South Korea')).toBe('KRW');
    expect(inferCurrency('South Africa')).toBe('ZAR');
    expect(inferCurrency('Cape Town, South Africa')).toBe('ZAR');
  });
});

describe('inferCurrency — table of destinations', () => {
  const table = [
    ['Chikmagaluru, Karnataka', 'INR'],
    ['Mumbai', 'INR'],
    ['Tokyo, Japan', 'JPY'],
    ['Kyoto', 'JPY'],
    ['London, England', 'GBP'],
    ['Edinburgh, Scotland', 'GBP'],
    ['New York, USA', 'USD'],
    ['Las Vegas', 'USD'],
    ['Austin, Texas', 'USD'],
    ['Portland, Oregon', 'USD'],
    ['Paris, France', 'EUR'],
    ['Barcelona, Spain', 'EUR'],
    ['Amsterdam, Netherlands', 'EUR'],
    ['Santorini, Greece', 'EUR'],
    ['Sydney, Australia', 'AUD'],
    ['Vancouver, Canada', 'CAD'],
    ['Singapore', 'SGD'],
    ['Dubai, UAE', 'AED'],
    ['Bangkok, Thailand', 'THB'],
    ['Bali, Indonesia', 'IDR'],
    ['Kuala Lumpur, Malaysia', 'MYR'],
    ['Interlaken, Switzerland', 'CHF'],
    ['Shanghai, China', 'CNY'],
    ['Seoul, South Korea', 'KRW'],
    ['Hanoi, Vietnam', 'VND'],
    ['Colombo, Sri Lanka', 'LKR'],
    ['Kathmandu, Nepal', 'NPR'],
    ['Rio de Janeiro, Brazil', 'BRL'],
    ['Cancun, Mexico', 'MXN'],
    ['Istanbul, Turkey', 'TRY'],
    ['Cairo, Egypt', 'EGP'],
    ['Marrakech, Morocco', 'MAD'],
    ['Queenstown, New Zealand', 'NZD'],
    ['Cebu, Philippines', 'PHP'],
    ['Reykjavik, Iceland', 'ISK'],
    ['Cusco, Peru', 'PEN'],
    ['Buenos Aires, Argentina', 'ARS'],
    ['Nairobi, Kenya', 'KES'],
    ['Zanzibar, Tanzania', 'TZS'],
    ['Doha, Qatar', 'QAR'],
    ['Tel Aviv, Israel', 'ILS'],
    ['Hong Kong', 'HKD'],
    ['Taipei, Taiwan', 'TWD'],
    ['Havana, Cuba', 'CUP'],
    ['Maldives', 'USD'],
  ];

  it.each(table)('%s -> %s', (destination, expected) => {
    expect(inferCurrency(destination)).toBe(expected);
  });

  it('every code in the table exists in CURRENCIES', () => {
    for (const [, code] of table) {
      expect(CURRENCIES[code], `${code} missing from CURRENCIES`).toBeDefined();
    }
  });
});

describe('inferCurrency — safe default', () => {
  // Returning null rather than guessing is the point: a wrong currency
  // mislabels every amount on the trip, while null lets the caller fall back.
  it('returns null for an unknown destination', () => {
    expect(inferCurrency('Atlantis')).toBeNull();
    expect(inferCurrency('Somewhere Nobody Has Heard Of')).toBeNull();
    expect(inferCurrency('Tunisia')).toBeNull();
  });

  it('returns null for empty and malformed input rather than throwing', () => {
    expect(inferCurrency('')).toBeNull();
    expect(inferCurrency(null)).toBeNull();
    expect(inferCurrency(undefined)).toBeNull();
    expect(inferCurrency('   ')).toBeNull();
    expect(inferCurrency(',,,')).toBeNull();
    expect(inferCurrency('123')).toBeNull();
  });

  it('never returns a code that is not in CURRENCIES', () => {
    const probes = [
      'Paris', 'Indiana', 'Lima, Ohio', 'Nowhere', '', 'Tokyo', 'xyzzy',
      'New York', 'Bali', 'Goa', 'Malta', 'Maldives',
    ];
    for (const p of probes) {
      const code = inferCurrency(p);
      if (code !== null) expect(CURRENCIES[code], `${p} -> ${code}`).toBeDefined();
    }
  });
});

describe('inferCurrency — normalisation', () => {
  it('ignores case, punctuation and extra whitespace', () => {
    expect(inferCurrency('  TOKYO ,  JAPAN  ')).toBe('JPY');
    expect(inferCurrency('paris/france')).toBe('EUR');
    expect(inferCurrency('New-York, USA')).toBe('USD');
  });

  it('handles accented input', () => {
    expect(inferCurrency('Zürich, Switzerland')).toBe('CHF');
  });
});

describe('currencySymbol', () => {
  it('returns the glyph for a known code', () => {
    expect(currencySymbol('INR')).toBe('₹');
    expect(currencySymbol('USD')).toBe('$');
  });

  it('falls back to the code itself, never to an empty label', () => {
    expect(currencySymbol('XYZ')).toBe('XYZ');
    expect(currencySymbol(null)).toBe('');
    expect(currencySymbol(undefined)).toBe('');
  });
});

describe('formatMoney', () => {
  it('defaults to whole units', () => {
    expect(formatMoney(1500, 'INR')).toBe('₹1,500');
  });

  // The settle-up panel depends on this: money views must be able to show cents,
  // or an exactly reconciling set of transfers displays as one that does not.
  it('shows cents when asked', () => {
    expect(formatMoney(323.55, 'INR', { decimals: 2 })).toBe('₹323.55');
    expect(formatMoney(0.33, 'USD', { decimals: 2 })).toBe('$0.33');
  });

  it('spaces codes that have no distinct glyph', () => {
    expect(formatMoney(400, 'AED')).toBe('AED 400');
  });

  it('treats junk as zero rather than printing NaN', () => {
    expect(formatMoney('abc', 'USD')).toBe('$0');
    expect(formatMoney(null, 'USD')).toBe('$0');
    expect(formatMoney(undefined, 'USD')).toBe('$0');
  });

  it('handles negatives', () => {
    expect(formatMoney(-50, 'USD', { decimals: 2 })).toBe('-$50.00');
  });
});
