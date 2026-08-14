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

/**
 * Export trip as iCalendar (.ics) file
 */
export function exportTripToCalendar(trip, days, activities, bookings = {}) {
  let ical = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//WanderForge//EN',
    `X-WR-CALNAME:${trip.title || 'Trip'}`,
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
  ];

  for (const day of days) {
    const dayActivities = activities[day.id] || [];

    for (const act of dayActivities) {
      const dateStr = day.date?.replace(/-/g, '') || '';
      if (!dateStr) continue;

      const startTime = act.start_time ? act.start_time.replace(/:/g, '').slice(0, 4) + '00' : '090000';
      const endTime = act.end_time ? act.end_time.replace(/:/g, '').slice(0, 4) + '00' : '100000';

      const uid = `${act.id}@wanderforge`;

      ical.push(
        'BEGIN:VEVENT',
        `UID:${uid}`,
        `DTSTART:${dateStr}T${startTime}`,
        `DTEND:${dateStr}T${endTime}`,
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
    const end = (s.check_out || s.check_in).replace(/-/g, '');
    ical.push(
      'BEGIN:VEVENT',
      `UID:stay-${s.id}@wanderforge`,
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
    const stamp = (v) => new Date(v).toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
    ical.push(
      'BEGIN:VEVENT',
      `UID:transport-${t.id}@wanderforge`,
      `DTSTART:${stamp(t.departure_time)}`,
      `DTEND:${stamp(t.arrival_time || t.departure_time)}`,
      `SUMMARY:${escapeIcal(`${(t.type || 'Transport').replace('_', ' ')}: ${t.from_location || '?'} to ${t.to_location || '?'}`)}`,
      t.booking_link ? `URL:${t.booking_link}` : '',
      'CATEGORIES:transport',
      'END:VEVENT'
    );
  }

  ical.push('END:VCALENDAR');

  const content = ical.filter(Boolean).join('\r\n');
  const blob = new Blob([content], { type: 'text/calendar;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `${(trip.title || 'trip').replace(/[^a-zA-Z0-9]/g, '_')}.ics`;
  link.click();
  URL.revokeObjectURL(url);
}

function escapeIcal(text) {
  return (text || '')
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\n/g, '\\n');
}

/**
 * Generate a shareable link for a trip
 */
export function generateShareLink(tripId) {
  const baseUrl = typeof window !== 'undefined' ? window.location.origin : '';
  return `${baseUrl}/trip/${tripId}`;
}
