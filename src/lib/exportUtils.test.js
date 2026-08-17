import { describe, expect, it } from 'vitest';
import { buildTripCalendar, calendarFilename } from '@/lib/exportUtils';

/**
 * ICS validation.
 *
 * Generation used to be welded to the DOM download, so the only way to inspect
 * the output was to click Export and open the file. It was never checked, and it
 * was not valid: no DTSTAMP, lines past the 75-octet limit, and all-day stay
 * events whose DTEND equalled DTSTART, which calendars silently drop.
 */

const TRIP = { title: 'Chikmagaluru Weekend' };

const DAYS = [
  { id: 'd1', date: '2026-09-01' },
  { id: 'd2', date: '2026-09-02' },
];

const ACTIVITIES = {
  d1: [
    {
      id: 'a1',
      title: 'Mullayanagiri Peak',
      location_name: 'Mullayanagiri, Chikmagaluru',
      category: 'nature',
      start_time: '09:30',
      end_time: '12:00',
      description: 'Highest peak in Karnataka.',
    },
  ],
  d2: [
    {
      id: 'a2',
      title: 'Coffee estate tour',
      category: 'food',
      start_time: '10:00',
      end_time: '11:30',
    },
  ],
};

const BOOKINGS = {
  stays: [
    { id: 's1', name: 'The Serai', address: 'Chikmagaluru', check_in: '2026-09-01', check_out: '2026-09-03' },
  ],
  transport: [
    { id: 't1', type: 'car_rental', from_location: 'Bengaluru', to_location: 'Chikmagaluru',
      departure_time: '2026-09-01T06:00:00Z', arrival_time: '2026-09-01T10:30:00Z' },
  ],
};

/** Unfold continuation lines so values can be asserted whole. */
function unfold(ics) {
  const out = [];
  for (const line of ics.split('\r\n')) {
    if (line.startsWith(' ') && out.length) out[out.length - 1] += line.slice(1);
    else out.push(line);
  }
  return out;
}

function events(ics) {
  const lines = unfold(ics);
  const found = [];
  let current = null;
  for (const line of lines) {
    if (line === 'BEGIN:VEVENT') { current = {}; continue; }
    if (line === 'END:VEVENT') { found.push(current); current = null; continue; }
    if (!current) continue;
    const idx = line.indexOf(':');
    const rawKey = line.slice(0, idx);
    current[rawKey.split(';')[0]] = line.slice(idx + 1);
  }
  return found;
}

describe('buildTripCalendar — structure', () => {
  const ics = buildTripCalendar(TRIP, DAYS, ACTIVITIES, BOOKINGS);

  it('uses CRLF line endings, as the spec requires', () => {
    expect(ics).toContain('\r\n');
    // No bare LF outside a CRLF pair.
    expect(/[^\r]\n/.test(ics)).toBe(false);
  });

  it('opens and closes the calendar exactly once', () => {
    expect(ics.startsWith('BEGIN:VCALENDAR\r\n')).toBe(true);
    expect(ics.trimEnd().endsWith('END:VCALENDAR')).toBe(true);
    expect(unfold(ics).filter((l) => l === 'BEGIN:VCALENDAR')).toHaveLength(1);
    expect(unfold(ics).filter((l) => l === 'END:VCALENDAR')).toHaveLength(1);
  });

  it('balances every BEGIN:VEVENT with an END:VEVENT', () => {
    const lines = unfold(ics);
    expect(lines.filter((l) => l === 'BEGIN:VEVENT').length)
      .toBe(lines.filter((l) => l === 'END:VEVENT').length);
  });

  it('emits one event per activity, stay and transport leg', () => {
    // 2 activities + 1 stay + 1 transport
    expect(events(ics)).toHaveLength(4);
  });

  it('declares VERSION and PRODID', () => {
    expect(ics).toContain('VERSION:2.0');
    expect(ics).toMatch(/PRODID:/);
  });

  it('folds every line to 75 octets or fewer', () => {
    for (const line of ics.split('\r\n')) {
      expect(line.length, `too long: ${line.slice(0, 40)}…`).toBeLessThanOrEqual(75);
    }
  });

  it('keeps a folded value intact once unfolded', () => {
    const long = 'x'.repeat(300);
    const out = buildTripCalendar(TRIP, DAYS, {
      d1: [{ id: 'a1', title: long, start_time: '09:00', end_time: '10:00' }],
    });
    for (const line of out.split('\r\n')) expect(line.length).toBeLessThanOrEqual(75);
    expect(unfold(out).some((l) => l === `SUMMARY:${long}`)).toBe(true);
  });
});

describe('buildTripCalendar — required event properties', () => {
  const ics = buildTripCalendar(TRIP, DAYS, ACTIVITIES, BOOKINGS);

  it('gives every event a UID, DTSTAMP, DTSTART and DTEND', () => {
    for (const ev of events(ics)) {
      expect(ev.UID, JSON.stringify(ev)).toBeTruthy();
      expect(ev.DTSTAMP, JSON.stringify(ev)).toBeTruthy();
      expect(ev.DTSTART, JSON.stringify(ev)).toBeTruthy();
      expect(ev.DTEND, JSON.stringify(ev)).toBeTruthy();
      expect(ev.SUMMARY, JSON.stringify(ev)).toBeTruthy();
    }
  });

  it('makes every UID unique', () => {
    const uids = events(ics).map((e) => e.UID);
    expect(new Set(uids).size).toBe(uids.length);
  });

  it('never emits DTEND at or before DTSTART', () => {
    for (const ev of events(ics)) {
      expect(ev.DTEND > ev.DTSTART, `${ev.SUMMARY}: ${ev.DTSTART} -> ${ev.DTEND}`).toBe(true);
    }
  });
});

describe('buildTripCalendar — the cases that used to produce broken files', () => {
  it('gives a stay with no check-out a one-night span, not a zero-length event', () => {
    const ics = buildTripCalendar(TRIP, [], {}, {
      stays: [{ id: 's1', name: 'Hotel', check_in: '2026-09-01' }],
    });
    const [ev] = events(ics);
    expect(ev.DTSTART).toBe('20260901');
    expect(ev.DTEND).toBe('20260902');
    expect(ev.DTEND > ev.DTSTART).toBe(true);
  });

  it('repairs a stay whose dates are reversed', () => {
    const ics = buildTripCalendar(TRIP, [], {}, {
      stays: [{ id: 's1', name: 'Hotel', check_in: '2026-09-05', check_out: '2026-09-01' }],
    });
    const [ev] = events(ics);
    expect(ev.DTEND > ev.DTSTART).toBe(true);
  });

  it('rolls an activity that ends before it starts onto the next day', () => {
    const ics = buildTripCalendar(TRIP, [{ id: 'd1', date: '2026-09-01' }], {
      d1: [{ id: 'a1', title: 'Night bus', start_time: '23:00', end_time: '02:00' }],
    });
    const [ev] = events(ics);
    expect(ev.DTSTART).toBe('20260901T230000');
    expect(ev.DTEND).toBe('20260902T020000');
  });

  it('handles a month boundary when rolling over', () => {
    const ics = buildTripCalendar(TRIP, [{ id: 'd1', date: '2026-09-30' }], {
      d1: [{ id: 'a1', title: 'Late', start_time: '23:30', end_time: '00:30' }],
    });
    expect(events(ics)[0].DTEND).toBe('20261001T003000');
  });

  it('skips transport with an unparseable departure instead of emitting a broken DTSTART', () => {
    const ics = buildTripCalendar(TRIP, [], {}, {
      transport: [{ id: 't1', type: 'bus', departure_time: 'not-a-date' }],
    });
    expect(events(ics)).toHaveLength(0);
    expect(ics).not.toContain('Invalid');
    expect(ics).not.toContain('NaN');
  });

  it('gives transport with no arrival a default duration', () => {
    const ics = buildTripCalendar(TRIP, [], {}, {
      transport: [{ id: 't1', type: 'bus', departure_time: '2026-09-01T06:00:00Z' }],
    });
    const [ev] = events(ics);
    expect(ev.DTEND > ev.DTSTART).toBe(true);
  });
});

describe('buildTripCalendar — escaping', () => {
  it('escapes commas, semicolons and backslashes in values', () => {
    const ics = buildTripCalendar(TRIP, [{ id: 'd1', date: '2026-09-01' }], {
      d1: [{
        id: 'a1',
        title: 'Cafe, Bar; and \\ Grill',
        start_time: '09:00',
        end_time: '10:00',
      }],
    });
    const [ev] = events(ics);
    expect(ev.SUMMARY).toBe('Cafe\\, Bar\\; and \\\\ Grill');
  });

  it('escapes CRLF inside a value so the line is not truncated', () => {
    const ics = buildTripCalendar(TRIP, [{ id: 'd1', date: '2026-09-01' }], {
      d1: [{
        id: 'a1',
        title: 'Two',
        description: 'line one\r\nline two',
        start_time: '09:00',
        end_time: '10:00',
      }],
    });
    const [ev] = events(ics);
    expect(ev.DESCRIPTION).toContain('line one\\nline two');
    expect(ev.DESCRIPTION).not.toContain('\r');
  });
});

describe('buildTripCalendar — degenerate input', () => {
  it('produces a valid empty calendar with no data at all', () => {
    const ics = buildTripCalendar({}, [], {}, {});
    expect(ics.startsWith('BEGIN:VCALENDAR')).toBe(true);
    expect(ics.trimEnd().endsWith('END:VCALENDAR')).toBe(true);
    expect(events(ics)).toHaveLength(0);
  });

  it('does not throw on missing arguments', () => {
    expect(() => buildTripCalendar()).not.toThrow();
    expect(() => buildTripCalendar(null, null, null, null)).not.toThrow();
  });

  it('skips days with no date rather than emitting an empty DTSTART', () => {
    const ics = buildTripCalendar(TRIP, [{ id: 'd1' }], {
      d1: [{ id: 'a1', title: 'Floating', start_time: '09:00', end_time: '10:00' }],
    });
    expect(events(ics)).toHaveLength(0);
    expect(ics).not.toContain('DTSTART:T');
  });
});

describe('calendarFilename', () => {
  it('sanitises the trip title', () => {
    expect(calendarFilename({ title: 'Goa / Trip #2!' })).toBe('Goa___Trip__2_.ics');
  });

  it('falls back when there is no title', () => {
    expect(calendarFilename({})).toBe('trip.ics');
    expect(calendarFilename(null)).toBe('trip.ics');
  });
});
