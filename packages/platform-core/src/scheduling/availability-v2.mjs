/**
 * Phase 6 — Calendar V2 Availability, Buffer, Notice, Time-Off & Timezone Engine
 * Computes bookable UTC slots for a calendar date in its configured IANA timezone
 * (handling DST transitions cleanly) while preserving PostgreSQL GiST exclusion as
 * the authoritative concurrency gate.
 */

export function formatTimeInTimeZone(dateInput, timeZone = 'UTC') {
  const date = dateInput instanceof Date ? dateInput : new Date(dateInput);
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  });
  const parts = Object.fromEntries(fmt.formatToParts(date).map((p) => [p.type, p.value]));
  const hour = parts.hour === '24' ? '00' : parts.hour;
  return {
    dateStr: `${parts.year}-${parts.month}-${parts.day}`,
    timeStr: `${hour}:${parts.minute}`
  };
}

export function getWeekdayNameInTimeZone(dateStr, timeZone = 'UTC') {
  const probe = new Date(`${dateStr}T12:00:00Z`);
  return new Intl.DateTimeFormat('en-US', { timeZone, weekday: 'long' })
    .format(probe)
    .toLowerCase();
}

export function computeAvailableSlots({
  dateStr,
  durationMin = 30,
  rules = {},
  existingAppointments = [],
  now = Date.now()
} = {}) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(dateStr || ''))) {
    throw Object.assign(new TypeError('dateStr must be YYYY-MM-DD'), { code: 'INVALID_DATE' });
  }

  const timeZone = rules.timezone || 'UTC';
  const bufferBeforeMs = Math.max(0, Number(rules.bufferBeforeMin || 0)) * 60_000;
  const bufferAfterMs = Math.max(0, Number(rules.bufferAfterMin || 0)) * 60_000;
  const minNoticeMs = Math.max(0, Number(rules.minNoticeMin ?? 60)) * 60_000;
  const maxFutureDays = Math.max(1, Number(rules.maxFutureDays ?? 60));
  const dailyLimit = rules.dailyLimit ? Number(rules.dailyLimit) : null;
  const slotMs = Math.max(5, Number(durationMin || 30)) * 60_000;

  // Check daily limit against non-cancelled appointments on dateStr in target timezone
  const activeDayAppts = existingAppointments.filter((a) => {
    if (a.status === 'cancelled') return false;
    return formatTimeInTimeZone(a.startsAt, timeZone).dateStr === dateStr;
  });
  if (dailyLimit !== null && activeDayAppts.length >= dailyLimit) {
    return [];
  }

  const weekday = getWeekdayNameInTimeZone(dateStr, timeZone);
  const windows = rules.weeklyWindows?.[weekday] || [{ start: '09:00', end: '17:00' }];
  if (!Array.isArray(windows) || windows.length === 0) {
    return [];
  }

  const timeOffBlocks = Array.isArray(rules.timeOffBlocks) ? rules.timeOffBlocks : [];
  const maxFutureMs = now + maxFutureDays * 86400_000;
  const slots = [];

  for (const win of windows) {
    const [sh, sm] = String(win.start || '09:00').split(':').map(Number);
    const [eh, em] = String(win.end || '17:00').split(':').map(Number);
    if (!Number.isFinite(sh) || !Number.isFinite(sm) || !Number.isFinite(eh) || !Number.isFinite(em)) continue;

    // Resolve local wall-clock start/end on dateStr into UTC timestamps
    const winStartMs = resolveLocalWallTimeToUtcMs(dateStr, sh, sm, timeZone);
    const winEndMs = resolveLocalWallTimeToUtcMs(dateStr, eh, em, timeZone);

    for (let cursor = winStartMs; cursor + slotMs <= winEndMs; cursor += slotMs) {
      const slotStart = cursor;
      const slotEnd = cursor + slotMs;

      if (slotStart < now + minNoticeMs) continue;
      if (slotStart > maxFutureMs) continue;

      const bufferedStart = slotStart - bufferBeforeMs;
      const bufferedEnd = slotEnd + bufferAfterMs;

      const overlapsAppt = existingAppointments.some((a) => {
        if (a.status === 'cancelled') return false;
        const aStart = new Date(a.startsAt).getTime();
        const aEnd = new Date(a.endsAt).getTime();
        return bufferedStart < aEnd && bufferedEnd > aStart;
      });
      if (overlapsAppt) continue;

      const overlapsTimeOff = timeOffBlocks.some((blk) => {
        const bStart = new Date(blk.startsAt).getTime();
        const bEnd = new Date(blk.endsAt).getTime();
        return slotStart < bEnd && slotEnd > bStart;
      });
      if (overlapsTimeOff) continue;

      slots.push({
        startsAt: new Date(slotStart).toISOString(),
        endsAt: new Date(slotEnd).toISOString(),
        localTime: formatTimeInTimeZone(slotStart, timeZone).timeStr,
        timezone: timeZone
      });
    }
  }

  return slots;
}

function resolveLocalWallTimeToUtcMs(dateStr, hour, minute, timeZone) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const utcGuess = Date.UTC(y, m - 1, d, hour, minute, 0, 0);
  const rendered = formatTimeInTimeZone(utcGuess, timeZone);
  const [ry, rm, rd] = rendered.dateStr.split('-').map(Number);
  const [rh, rmin] = rendered.timeStr.split(':').map(Number);
  const renderedUtc = Date.UTC(ry, rm - 1, rd, rh, rmin, 0, 0);
  const offsetMs = renderedUtc - utcGuess;
  return utcGuess - offsetMs;
}
