/**
 * ============================================================================
 * Operza Workflow Scheduler 2.0 — UTC & IANA Timezone Scheduling
 * ============================================================================
 * Computes DST-aware next-run timestamps in UTC using explicit IANA timezones
 * and evaluates missed-run catch-up policies without relying on machine-local
 * timezones.
 */

export function isValidIanaTimezone(tz) {
  if (typeof tz !== 'string' || !tz.trim()) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz }).format(new Date());
    return true;
  } catch {
    return false;
  }
}

export function getZonedParts(date, timezone = 'UTC') {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  });
  const parts = Object.fromEntries(fmt.formatToParts(date).map(p => [p.type, p.value]));
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour === '24' ? '0' : parts.hour),
    minute: Number(parts.minute),
    second: Number(parts.second)
  };
}

export function computeNextRunAtUtc({
  scheduleType = 'interval',
  timezone = 'UTC',
  intervalEvery = 1,
  intervalUnit = 'hours',
  cronExpression = null,
  runAt = null,
  fromDate = new Date()
} = {}) {
  if (!isValidIanaTimezone(timezone)) {
    throw Object.assign(new TypeError(`Invalid IANA timezone: ${timezone}`), { code: 'INVALID_TIMEZONE' });
  }
  const base = fromDate instanceof Date ? fromDate : new Date(fromDate);
  if (Number.isNaN(base.getTime())) {
    throw Object.assign(new TypeError('Invalid reference date'), { code: 'INVALID_DATE' });
  }

  if (scheduleType === 'once') {
    const target = runAt ? new Date(runAt) : null;
    if (!target || Number.isNaN(target.getTime())) {
      throw Object.assign(new TypeError('One-time schedule requires valid runAt'), { code: 'INVALID_SCHEDULE' });
    }
    return target > base ? target.toISOString() : null;
  }

  if (scheduleType === 'interval') {
    const every = Math.max(1, Math.min(10080, Number(intervalEvery) || 1));
    const unitMs = intervalUnit === 'days' ? 86_400_000 : intervalUnit === 'hours' ? 3_600_000 : 60_000;
    return new Date(base.getTime() + every * unitMs).toISOString();
  }

  if (scheduleType === 'cron') {
    const fields = String(cronExpression || '').trim().split(/\s+/);
    if (fields.length !== 5) {
      throw Object.assign(new TypeError('Cron expression must have 5 fields (min hour dom month dow)'), { code: 'INVALID_CRON' });
    }
    const [minExpr, hourExpr] = fields;
    const targetMin = minExpr === '*' ? null : Number(minExpr);
    const targetHour = hourExpr === '*' ? null : Number(hourExpr);
    if ((targetMin !== null && (!Number.isInteger(targetMin) || targetMin < 0 || targetMin > 59)) ||
        (targetHour !== null && (!Number.isInteger(targetHour) || targetHour < 0 || targetHour > 23))) {
      throw Object.assign(new TypeError('Cron minute/hour out of range'), { code: 'INVALID_CRON' });
    }

    // Step minute-by-minute up to 48 hours in UTC while matching local wall-clock in `timezone`
    // so DST spring-forward/fall-back transitions behave accurately.
    const startMs = Math.ceil((base.getTime() + 1000) / 60_000) * 60_000;
    for (let offsetMin = 0; offsetMin < 2880; offsetMin += 1) {
      const candidate = new Date(startMs + offsetMin * 60_000);
      const zoned = getZonedParts(candidate, timezone);
      if ((targetMin === null || zoned.minute === targetMin) &&
          (targetHour === null || zoned.hour === targetHour)) {
        return candidate.toISOString();
      }
    }
    return new Date(startMs + 86_400_000).toISOString();
  }

  throw Object.assign(new TypeError(`Unsupported scheduleType: ${scheduleType}`), { code: 'INVALID_SCHEDULE' });
}

export function evaluateMissedRuns({
  nextRunAt,
  now = new Date(),
  catchupPolicy = 'skip',
  maxCatchup = 5,
  scheduleParams = {}
} = {}) {
  if (!nextRunAt) return { dueRuns: [], nextScheduledAt: null };
  const dueAt = new Date(nextRunAt);
  const current = now instanceof Date ? now : new Date(now);
  if (dueAt > current) {
    return { dueRuns: [], nextScheduledAt: dueAt.toISOString() };
  }

  if (catchupPolicy === 'skip') {
    return {
      dueRuns: [current.toISOString()],
      nextScheduledAt: computeNextRunAtUtc({ ...scheduleParams, fromDate: current })
    };
  }

  if (catchupPolicy === 'run_once') {
    return {
      dueRuns: [dueAt.toISOString()],
      nextScheduledAt: computeNextRunAtUtc({ ...scheduleParams, fromDate: current })
    };
  }

  // catch_up (bounded)
  const dueRuns = [dueAt.toISOString()];
  let cursor = dueAt;
  for (let i = 1; i < maxCatchup; i += 1) {
    const nextIso = computeNextRunAtUtc({ ...scheduleParams, fromDate: cursor });
    if (!nextIso) break;
    const nextDate = new Date(nextIso);
    if (nextDate > current) {
      return { dueRuns, nextScheduledAt: nextIso };
    }
    dueRuns.push(nextIso);
    cursor = nextDate;
  }
  return {
    dueRuns,
    nextScheduledAt: computeNextRunAtUtc({ ...scheduleParams, fromDate: current })
  };
}
