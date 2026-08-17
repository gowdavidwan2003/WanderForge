/**
 * Export trip as a downloadable PDF
 * Uses jsPDF library
 */
import { accommodationTotal, nightsBetween, bookingsTotal } from './bookings';

export async function exportTripToPDF(trip, days, activities, bookings = {}) {
  const { default: jsPDF } = await import('jspdf');
  const doc = new jsPDF();

  const margin = 20;
  let y = margin;
  const pageWidth = doc.internal.pageSize.getWidth();
  const contentWidth = pageWidth - 2 * margin;

  const addPage = () => {
    doc.addPage();
    y = margin;
  };

  const checkPageBreak = (needed = 30) => {
    if (y + needed > doc.internal.pageSize.getHeight() - margin) {
      addPage();
    }
  };

  // Header
  doc.setFillColor(232, 184, 125); // Primary color
  doc.rect(0, 0, pageWidth, 45, 'F');

  doc.setTextColor(255, 255, 255);
  doc.setFontSize(24);
  doc.setFont('helvetica', 'bold');
  doc.text(trip.title || 'Untitled Trip', margin, 22);

  doc.setFontSize(12);
  doc.setFont('helvetica', 'normal');
  doc.text(`${trip.destination || 'No destination'}`, margin, 32);

  if (trip.start_date) {
    const start = new Date(trip.start_date).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
    const end = trip.end_date ? new Date(trip.end_date).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }) : '';
    doc.text(`${start}${end ? ' — ' + end : ''}`, margin, 40);
  }

  y = 55;
  doc.setTextColor(51, 51, 51);

  // Trip Summary
  doc.setFontSize(11);
  doc.setFont('helvetica', 'normal');

  const stays = bookings.stays || [];
  const transport = bookings.transport || [];
  const booked = bookingsTotal(stays, transport);
  const totalCost =
    Object.values(activities).flat().reduce((sum, a) => sum + (parseFloat(a.cost) || 0), 0) + booked.total;
  const totalActivities = Object.values(activities).flat().length;
  doc.text(`${days.length} days  ·  ${totalActivities} activities  ·  ${trip.currency || 'USD'} ${totalCost.toFixed(0)} estimated`, margin, y);
  y += 12;

  // Bookings sit before the day-by-day plan: they are the fixed points a
  // traveler checks first.
  if (stays.length || transport.length) {
    doc.setFontSize(13);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(139, 90, 43);
    doc.text('Bookings', margin, y);
    y += 7;

    doc.setFontSize(9);
    doc.setTextColor(90, 90, 90);

    for (const s of stays) {
      checkPageBreak(14);
      const nights = nightsBetween(s.check_in, s.check_out);
      doc.setFont('helvetica', 'bold');
      doc.text(`Stay: ${s.name}`, margin + 4, y);
      doc.setFont('helvetica', 'normal');
      const detail = [
        s.check_in ? `${s.check_in} to ${s.check_out || '?'}` : null,
        nights ? `${nights} night${nights === 1 ? '' : 's'}` : null,
        accommodationTotal(s) ? `${trip.currency || 'USD'} ${accommodationTotal(s).toFixed(0)}` : null,
        s.address || null,
      ].filter(Boolean).join('  ·  ');
      y += 4.5;
      if (detail) { doc.text(detail, margin + 8, y); y += 5.5; } else { y += 1.5; }
    }

    for (const t of transport) {
      checkPageBreak(14);
      doc.setFont('helvetica', 'bold');
      doc.text(`${(t.type || 'transport').replace('_', ' ')}: ${t.from_location || '?'} to ${t.to_location || '?'}`, margin + 4, y);
      doc.setFont('helvetica', 'normal');
      const detail = [
        t.departure_time ? new Date(t.departure_time).toLocaleString() : null,
        t.cost ? `${trip.currency || 'USD'} ${Number(t.cost).toFixed(0)}` : null,
      ].filter(Boolean).join('  ·  ');
      y += 4.5;
      if (detail) { doc.text(detail, margin + 8, y); y += 5.5; } else { y += 1.5; }
    }

    y += 6;
    doc.setTextColor(51, 51, 51);
  }

  // Each Day
  for (const day of days) {
    checkPageBreak(40);

    // Day header
    doc.setFillColor(245, 240, 235);
    doc.roundedRect(margin, y - 4, contentWidth, 18, 3, 3, 'F');

    doc.setFontSize(14);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(139, 90, 43); // Accent color
    const dateStr = day.date
      ? new Date(day.date + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })
      : '';
    doc.text(`Day ${day.day_number}   ${dateStr}`, margin + 6, y + 8);
    y += 22;

    const dayActivities = activities[day.id] || [];

    if (dayActivities.length === 0) {
      doc.setFontSize(10);
      doc.setFont('helvetica', 'italic');
      doc.setTextColor(150, 150, 150);
      doc.text('No activities planned', margin + 10, y);
      y += 12;
      continue;
    }

    for (const act of dayActivities) {
      checkPageBreak(35);

      // Time badge
      doc.setFontSize(9);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(100, 100, 100);
      if (act.start_time) {
        const timeStr = `${act.start_time.slice(0, 5)}${act.end_time ? ' – ' + act.end_time.slice(0, 5) : ''}`;
        doc.text(timeStr, margin + 4, y);
      }

      // Activity title
      doc.setFontSize(11);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(51, 51, 51);
      doc.text(act.title, margin + 40, y);
      y += 5;

      // Location & cost
      doc.setFontSize(9);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(120, 120, 120);
      let detailLine = '';
      if (act.location_name) detailLine += act.location_name;
      if (parseFloat(act.cost) > 0) {
        detailLine += detailLine ? '  ·  ' : '';
        detailLine += `${trip.currency || 'USD'} ${parseFloat(act.cost).toFixed(0)}`;
      }
      if (detailLine) {
        doc.text(detailLine, margin + 40, y);
        y += 4;
      }

      // Description
      if (act.description) {
        doc.setFontSize(8);
        doc.setTextColor(140, 140, 140);
        const lines = doc.splitTextToSize(act.description, contentWidth - 45);
        doc.text(lines.slice(0, 2), margin + 40, y + 1);
        y += lines.slice(0, 2).length * 3.5;
      }

      // Notes
      if (act.notes) {
        doc.setFontSize(8);
        doc.setFont('helvetica', 'italic');
        doc.setTextColor(160, 160, 160);
        const noteLines = doc.splitTextToSize(`Tip: ${act.notes}`, contentWidth - 45);
        doc.text(noteLines.slice(0, 2), margin + 40, y + 2);
        y += noteLines.slice(0, 2).length * 3.5 + 2;
      }

      y += 6;
    }

    y += 4;
  }

  // Footer
  checkPageBreak(20);
  y += 5;
  doc.setDrawColor(200, 200, 200);
  doc.line(margin, y, pageWidth - margin, y);
  y += 8;
  doc.setFontSize(8);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(160, 160, 160);
  doc.text(`Generated by WanderForge · ${new Date().toLocaleDateString()}`, margin, y);

  // Download
  const filename = `${(trip.title || 'trip').replace(/[^a-zA-Z0-9]/g, '_')}_itinerary.pdf`;
  doc.save(filename);
}

/** Shift a yyyymmdd string by whole days, staying in UTC to avoid DST drift. */
function shiftDateStamp(stamp, days) {
  const y = Number(stamp.slice(0, 4));
  const m = Number(stamp.slice(4, 6));
  const d = Number(stamp.slice(6, 8));
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10).replace(/-/g, '');
}

/**
 * Fold lines to 75 octets, as RFC 5545 requires.
 *
 * Long values — an activity description, a venue name — produced lines well past
 * the limit. Google Calendar tolerates them; stricter parsers reject the file
 * outright, which made "export to calendar" work or not depending on where it
 * was opened. Continuation lines begin with a single space.
 */
function foldIcalLines(lines) {
  const folded = [];
  for (const line of lines) {
    if (line.length <= 75) { folded.push(line); continue; }
    folded.push(line.slice(0, 75));
    let rest = line.slice(75);
    while (rest.length > 74) {
      folded.push(` ${rest.slice(0, 74)}`);
      rest = rest.slice(74);
    }
    if (rest.length) folded.push(` ${rest}`);
  }
  return folded;
}

/**
 * Build the iCalendar body for a trip.
 *
 * Separated from the download so it can be tested. Previously the only way to
 * see the output was to click Export in a browser and open the file, so the ICS
 * was never validated: it shipped without the DTSTAMP every VEVENT requires, with
 * lines past the 75-octet limit, and with all-day stay events whose DTEND equalled
 * their DTSTART — a zero-length event that calendars silently drop, so a booking
 * with no check-out date simply never appeared.
 *
 * @returns {string} CRLF-delimited iCalendar text
 */
export function buildTripCalendar(trip, daysInput, activitiesInput, bookingsInput) {
  // Defaults, not default parameters: callers pass explicit nulls from state that
  // has not loaded yet, and `= []` does not apply to null.
  const days = Array.isArray(daysInput) ? daysInput : [];
  const activities = activitiesInput || {};
  const bookings = bookingsInput || {};

  // One stamp for the whole file: DTSTAMP is when the event was generated.
  const dtstamp = `${new Date().toISOString().replace(/[-:]/g, '').split('.')[0]}Z`;

  let ical = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//WanderForge//EN',
    `X-WR-CALNAME:${escapeIcal(trip?.title || 'Trip')}`,
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
  ];

  for (const day of days) {
    const dayActivities = activities[day.id] || [];

    for (const act of dayActivities) {
      const dateStr = day.date?.replace(/-/g, '') || '';
      if (!dateStr) continue;

      const startTime = act.start_time ? act.start_time.replace(/:/g, '').slice(0, 4) + '00' : '090000';
      let endTime = act.end_time ? act.end_time.replace(/:/g, '').slice(0, 4) + '00' : '100000';
      let endDate = dateStr;

      // An activity ending at or before it starts — a late-night entry running
      // past midnight, or simply bad data — produced DTEND <= DTSTART, which is
      // invalid. Roll the end onto the next day, which is what the times mean.
      if (endTime <= startTime) {
        endDate = shiftDateStamp(dateStr, 1);
      }

      const uid = `${act.id}@wanderforge`;

      ical.push(
        'BEGIN:VEVENT',
        `UID:${uid}`,
        `DTSTAMP:${dtstamp}`,
        `DTSTART:${dateStr}T${startTime}`,
        `DTEND:${endDate}T${endTime}`,
        `SUMMARY:${escapeIcal(act.title)}`,
        act.location_name ? `LOCATION:${escapeIcal(act.location_name)}` : '',
        act.description ? `DESCRIPTION:${escapeIcal(act.description)}${act.notes ? '\\n\\nTip: ' + escapeIcal(act.notes) : ''}` : '',
        act.booking_link ? `URL:${act.booking_link}` : '',
        `CATEGORIES:${act.category || 'sightseeing'}`,
        'END:VEVENT'
      );
    }
  }

  // Stays become all-day events spanning the booking; transport becomes a timed
  // event, so the whole trip lands in the traveler's calendar, not just sights.
  for (const s of bookings.stays || []) {
    if (!s.check_in) continue;
    const start = s.check_in.replace(/-/g, '');
    let end = (s.check_out || '').replace(/-/g, '');

    // DTEND is exclusive for an all-day event, so check-out is already the right
    // value for a hotel stay. But falling back to check_in when check-out is
    // missing made DTSTART equal DTEND — a zero-length event that calendars drop,
    // so the booking never appeared at all. Same if the dates are reversed.
    if (!end || end <= start) {
      end = shiftDateStamp(start, 1);
    }

    ical.push(
      'BEGIN:VEVENT',
      `UID:stay-${s.id}@wanderforge`,
      `DTSTAMP:${dtstamp}`,
      `DTSTART;VALUE=DATE:${start}`,
      `DTEND;VALUE=DATE:${end}`,
      `SUMMARY:${escapeIcal(`Stay: ${s.name}`)}`,
      s.address ? `LOCATION:${escapeIcal(s.address)}` : '',
      s.booking_link ? `URL:${s.booking_link}` : '',
      'CATEGORIES:accommodation',
      'END:VEVENT'
    );
  }

  for (const t of bookings.transport || []) {
    if (!t.departure_time) continue;
    const stamp = (v) => {
      const d = new Date(v);
      return Number.isNaN(d.getTime())
        ? null
        : `${d.toISOString().replace(/[-:]/g, '').split('.')[0]}Z`;
    };

    const start = stamp(t.departure_time);
    if (!start) continue; // an unparseable departure would emit a broken DTSTART

    // An arrival at or before departure is invalid; default to an hour.
    let end = stamp(t.arrival_time);
    if (!end || end <= start) {
      const d = new Date(t.departure_time);
      d.setUTCHours(d.getUTCHours() + 1);
      end = `${d.toISOString().replace(/[-:]/g, '').split('.')[0]}Z`;
    }

    ical.push(
      'BEGIN:VEVENT',
      `UID:transport-${t.id}@wanderforge`,
      `DTSTAMP:${dtstamp}`,
      `DTSTART:${start}`,
      `DTEND:${end}`,
      `SUMMARY:${escapeIcal(`${(t.type || 'Transport').replace('_', ' ')}: ${t.from_location || '?'} to ${t.to_location || '?'}`)}`,
      t.booking_link ? `URL:${t.booking_link}` : '',
      'CATEGORIES:transport',
      'END:VEVENT'
    );
  }

  ical.push('END:VCALENDAR');

  return foldIcalLines(ical.filter(Boolean)).join('\r\n');
}

/** Filename for a trip's .ics download. */
export function calendarFilename(trip) {
  return `${(trip?.title || 'trip').replace(/[^a-zA-Z0-9]/g, '_')}.ics`;
}

/**
 * Export trip as an iCalendar (.ics) file.
 *
 * Download only — all the generation lives in buildTripCalendar so it can be
 * tested without a DOM.
 */
export function exportTripToCalendar(trip, days, activities, bookings = {}) {
  const content = buildTripCalendar(trip, days, activities, bookings);
  const blob = new Blob([content], { type: 'text/calendar;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = calendarFilename(trip);
  link.click();
  URL.revokeObjectURL(url);
}

function escapeIcal(text) {
  return (text || '')
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    // CRLF first: replacing only \n left the carriage return in place, which
    // terminates the line early and truncates the value.
    .replace(/\r\n|\r|\n/g, '\\n');
}

/**
 * Generate a shareable link for a trip
 */
export function generateShareLink(tripId) {
  const baseUrl = typeof window !== 'undefined' ? window.location.origin : '';
  return `${baseUrl}/trip/${tripId}`;
}
