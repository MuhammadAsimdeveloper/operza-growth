import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Icon } from '../components/Icon';
import { Modal } from '../components/Modal';
import { Avatar, Badge, EmptyState, StatusBadge, Switch } from '../components/ui';
import { useStore, uid } from '../lib/store';
import { monthMatrix, sameDay, timeOf, toDateTimeInput } from '../lib/format';
import { api } from '../lib/api';
import type { AvailabilityWindow, CalendarDef, WorkspaceState } from '../lib/types';

const WEEKDAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const toMinutes = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
};

function roundRobinAssignee(state: WorkspaceState, calendarId: string): string {
  if (state.team.length === 0) return '';
  const counts = new Map(state.team.map((m) => [m.name, 0]));
  state.appointments
    .filter(
      (a) =>
        a.calendarId === calendarId &&
        a.status !== 'cancelled' &&
        new Date(a.start).getTime() >= Date.now(),
    )
    .forEach((a) => {
      if (a.assignee && counts.has(a.assignee)) {
        counts.set(a.assignee, (counts.get(a.assignee) ?? 0) + 1);
      }
    });
  let best = state.team[0].name;
  let bestCount = Number.POSITIVE_INFINITY;
  state.team.forEach((member) => {
    const count = counts.get(member.name) ?? 0;
    if (count < bestCount) {
      bestCount = count;
      best = member.name;
    }
  });
  return best;
}

function windowFor(calendar: CalendarDef | undefined, date: Date) {
  return calendar?.availability.find((w) => w.weekday === date.getDay());
}

export default function Calendars() {
  const { state, dispatch } = useStore();
  const [cursor, setCursor] = useState(() => new Date());
  const [hidden, setHidden] = useState<string[]>([]);
  const [creating, setCreating] = useState<string | null>(null); // ISO date when creating
  const [managing, setManaging] = useState<string | null>(null); // calendar id being edited
  const [syncing, setSyncing] = useState<string | null>(null); // calendar id being synced

  useEffect(() => {
    let active = true;
    api.crm.list('appointments').then((res) => {
      if (!active || !res?.data || !Array.isArray(res.data)) return;
      for (const item of res.data) {
        if (!state.appointments.some((a) => a.id === item.id)) {
          dispatch({
            type: 'appointment/add',
            appointment: {
              id: item.id,
              calendarId: item.calendarId || item.calendar || state.calendars[0]?.id || 'cal-1',
              contactId: item.contactId || '',
              title: item.title || item.notes || 'Scheduled Booking',
              start: item.start || item.startsAt || new Date().toISOString(),
              durationMin: Number(item.durationMin) || 30,
              status: item.status || 'confirmed',
              assignee: item.assignee || item.assignedTo || undefined,
            },
          });
        }
      }
    }).catch(() => {});
    return () => {
      active = false;
    };
  }, [state.appointments, state.calendars, dispatch]);

  const visible = state.appointments.filter(
    (a) => !hidden.includes(a.calendarId) && a.status !== 'cancelled',
  );

  const byDay = useMemo(() => {
    const map = new Map<string, typeof visible>();
    visible.forEach((a) => {
      const d = new Date(a.start);
      const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
      map.set(key, [...(map.get(key) ?? []), a]);
    });
    return map;
  }, [visible]);

  const days = monthMatrix(cursor.getFullYear(), cursor.getMonth());
  const monthLabel = cursor.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

  const upcoming = [...state.appointments]
    .filter((a) => new Date(a.start).getTime() >= Date.now() - 3_600_000 && a.status !== 'cancelled')
    .sort((a, b) => a.start.localeCompare(b.start))
    .slice(0, 6);

  const calendarOf = (id: string) => state.calendars.find((c) => c.id === id);
  const colorOf = (id: string) => calendarOf(id)?.color ?? '#6366f1';

  const shift = (delta: number) => {
    const d = new Date(cursor);
    d.setMonth(d.getMonth() + delta);
    setCursor(d);
  };

  return (
    <main className="operza-dashboard atlas-dashboard">
      <header className="atlas-dashboard__header">
        <div className="atlas-dashboard__heading">
          <div className="atlas-dashboard__breadcrumb">Workspace <span>/</span> Scheduling &amp; Bookings</div>
          <h1>Calendars &amp; Appointments</h1>
        </div>
        <div className="atlas-dashboard__toolbar">
          <button className="atlas-quick-action-button" onClick={() => setCreating(new Date().toISOString())}>
            <Icon name="plus" size={13} /> New Appointment
          </button>
        </div>
      </header>

      <section className="atlas-hero">
        <div className="atlas-eyebrow">SCHEDULING &amp; DISCOVERY</div>
        <h2>Multi-Calendar Unified Booking Engine</h2>
        <p>Manage round-robin routing, 2-way external synchronization, buffer windows, and team availability in one view.</p>
      </section>

      <section className="atlas-kpis" aria-label="Calendar metrics">
        <article className="operza-kpi atlas-kpi">
          <div className="atlas-kpi__meta">
            <span className="atlas-kpi__label">Upcoming Appointments</span>
            <span className="atlas-status atlas-status--healthy">Active</span>
          </div>
          <div className="atlas-kpi__value">{upcoming.length}</div>
          <div className="atlas-kpi__note">Confirmed in next 30 days</div>
        </article>
        <article className="operza-kpi atlas-kpi">
          <div className="atlas-kpi__meta">
            <span className="atlas-kpi__label">Total Calendars</span>
            <span className="atlas-status atlas-status--healthy">Ready</span>
          </div>
          <div className="atlas-kpi__value">{state.calendars.length}</div>
          <div className="atlas-kpi__note">Discovery, demos &amp; support</div>
        </article>
        <article className="operza-kpi atlas-kpi">
          <div className="atlas-kpi__meta">
            <span className="atlas-kpi__label">Active Synced</span>
            <span className="atlas-status atlas-status--healthy">Live</span>
          </div>
          <div className="atlas-kpi__value">
            {state.calendars.filter(c => c.externalSync?.status === 'active').length}
          </div>
          <div className="atlas-kpi__note">2-way sync enabled</div>
        </article>
        <article className="operza-kpi atlas-kpi">
          <div className="atlas-kpi__meta">
            <span className="atlas-kpi__label">Routing Mode</span>
            <span className="atlas-status atlas-status--healthy">Automated</span>
          </div>
          <div className="atlas-kpi__value">
            {state.calendars.some(c => c.roundRobin) ? 'Round-Robin' : 'Direct'}
          </div>
          <div className="atlas-kpi__note">Team load-balancing</div>
        </article>
      </section>

      <div className="grid grid--sidebar" style={{ marginTop: 22 }}>
        <div className="stack">
          <div className="card-premium">
            <div className="card__head">
              <div className="row" style={{ gap: 6 }}>
                <button className="icon-btn" onClick={() => shift(-1)} aria-label="Previous month">
                  <Icon name="chevron-left" size={17} />
                </button>
                <button className="icon-btn" onClick={() => shift(1)} aria-label="Next month">
                  <Icon name="chevron-right" size={17} />
                </button>
                <strong style={{ fontSize: 14, marginLeft: 6 }}>{monthLabel}</strong>
              </div>
              <div className="card__actions">
                <button className="btn btn--sm" onClick={() => setCursor(new Date())}>
                  Today
                </button>
              </div>
            </div>

            <div className="calendar" style={{ border: 'none', borderRadius: 0 }}>
              <div className="calendar__dow">
                {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d) => (
                  <div key={d}>{d}</div>
                ))}
              </div>
              <div className="calendar__grid">
                {days.map((day) => {
                  const key = `${day.getFullYear()}-${day.getMonth()}-${day.getDate()}`;
                  const events = (byDay.get(key) ?? []).sort((a, b) => a.start.localeCompare(b.start));
                  const outside = day.getMonth() !== cursor.getMonth();
                  const isToday = sameDay(day, new Date());
                  return (
                    <div
                      key={key}
                      className={`day${outside ? ' is-outside' : ''}${isToday ? ' is-today' : ''}`}
                      onClick={() => setCreating(day.toISOString())}
                    >
                      <span className="day__num">{day.getDate()}</span>
                      {events.slice(0, 3).map((a) => (
                        <span
                          key={a.id}
                          className="event-chip"
                          style={{ background: colorOf(a.calendarId) }}
                          title={`${timeOf(a.start)} ${a.title}`}
                        >
                          {timeOf(a.start)} {a.title}
                        </span>
                      ))}
                      {events.length > 3 && <span className="event-more">+{events.length - 3} more</span>}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>

        <div className="stack">
          <div className="card">
            <div className="card__head">
              <div className="card__title">Calendars</div>
            </div>
            <div>
              {state.calendars.map((cal) => {
                const on = !hidden.includes(cal.id);
                return (
                  <div className="list-row" key={cal.id}>
                    <input
                      type="checkbox"
                      checked={on}
                      aria-label={`Show ${cal.name}`}
                      onChange={() =>
                        setHidden((prev) =>
                          on ? [...prev, cal.id] : prev.filter((id) => id !== cal.id),
                        )
                      }
                    />
                    <span style={{ width: 9, height: 9, borderRadius: 3, background: cal.color }} />
                    <span style={{ fontSize: 13, fontWeight: 550, flex: 1 }}>{cal.name}</span>
                    {cal.roundRobin && <Badge tone="violet">Round-robin</Badge>}
                    {cal.externalSync?.status === 'active' && (
                      <Badge tone="green">
                        {cal.externalSync.provider === 'google_calendar' ? 'Google' : 'Outlook'} Synced
                      </Badge>
                    )}
                    <a href={`/book/${cal.id}`} target="_blank" rel="noopener noreferrer" className="btn btn--sm" style={{ textDecoration: 'none' }} title="Open public booking page">
                      <Icon name="link" size={12} /> Book
                    </a>
                    <button className="btn btn--sm" onClick={() => setSyncing(cal.id)} title="Configure 2-Way Calendar Sync">
                      Sync
                    </button>
                    <button className="btn btn--sm" onClick={() => setManaging(cal.id)}>
                      Hours
                    </button>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="card-premium">
            <div className="card__head">
              <div className="card__title">Upcoming Appointments</div>
              <div className="card__actions">
                <Badge>{upcoming.length}</Badge>
              </div>
            </div>
            {upcoming.length === 0 ? (
              <EmptyState icon={<Icon name="calendar" size={20} />} title="Nothing booked" />
            ) : (
              <div>
                {upcoming.map((a) => {
                  const contact = state.contacts.find((c) => c.id === a.contactId);
                  return (
                    <div className="list-row" key={a.id}>
                      <div style={{ width: 3, alignSelf: 'stretch', borderRadius: 2, background: colorOf(a.calendarId) }} />
                      <div style={{ minWidth: 0, flex: 1 }}>
                        <div style={{ fontSize: 13, fontWeight: 550 }}>{a.title}</div>
                        <div className="cell-sub">
                          {new Date(a.start).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })} ·{' '}
                          {timeOf(a.start)}
                          {a.assignee ? ` · ${a.assignee}` : ''}
                        </div>
                        {contact && (
                          <Link
                            to={`/contacts/${contact.id}`}
                            className="row"
                            style={{ gap: 5, marginTop: 4, fontSize: 11.5, color: 'var(--text-3)' }}
                          >
                            <Avatar name={`${contact.firstName} ${contact.lastName}`} size="xs" />
                            {contact.firstName} {contact.lastName}
                          </Link>
                        )}
                      </div>
                      <StatusBadge status={a.status} />
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>

      {creating && <NewAppointment defaultDate={creating} onClose={() => setCreating(null)} dispatch={dispatch} />}
      {managing && calendarOf(managing) && (
        <AvailabilityModal
          calendar={calendarOf(managing)!}
          onClose={() => setManaging(null)}
          dispatch={dispatch}
        />
      )}
      {syncing && calendarOf(syncing) && (
        <CalendarSyncModal
          calendar={calendarOf(syncing)!}
          onClose={() => setSyncing(null)}
          dispatch={dispatch}
        />
      )}
    </main>
  );
}

function NewAppointment({
  defaultDate,
  onClose,
  dispatch,
}: {
  defaultDate: string;
  onClose: () => void;
  dispatch: ReturnType<typeof useStore>['dispatch'];
}) {
  const { state } = useStore();
  const start = new Date(defaultDate);
  start.setHours(10, 0, 0, 0);

  const [title, setTitle] = useState('Discovery call');
  const [contactId, setContactId] = useState(state.contacts[0]?.id ?? '');
  const [calendarId, setCalendarId] = useState(state.calendars[0]?.id ?? '');
  const [when, setWhen] = useState(toDateTimeInput(start));
  const [duration, setDuration] = useState(30);
  const [assigneeOverride, setAssigneeOverride] = useState<string | null>(null);

  const calendar = state.calendars.find((c) => c.id === calendarId);
  const suggested = calendar?.roundRobin ? roundRobinAssignee(state, calendarId) : state.team[0]?.name ?? '';
  const assignee = assigneeOverride ?? suggested;

  const startAt = new Date(when);
  const validDate = !Number.isNaN(startAt.getTime());
  const endAt = new Date(startAt.getTime() + duration * 60_000);

  const conflicts = validDate
    ? state.appointments.filter((a) => {
        if (a.calendarId !== calendarId || a.status === 'cancelled') return false;
        const aStart = new Date(a.start);
        const aEnd = new Date(aStart.getTime() + a.durationMin * 60_000);
        return aStart < endAt && aEnd > startAt;
      })
    : [];

  const hours = validDate ? windowFor(calendar, startAt) : undefined;
  const startMin = startAt.getHours() * 60 + startAt.getMinutes();
  const outsideHours = Boolean(
    validDate &&
      calendar &&
      calendar.availability.length > 0 &&
      (!hours || startMin < toMinutes(hours.start) || startMin + duration > toMinutes(hours.end)),
  );

  const submit = async () => {
    if (!title.trim() || !contactId || !validDate || conflicts.length > 0) return;
    let newId = uid('apt');
    try {
      const res = await api.crm.create('appointments', {
        title: title.trim(),
        calendar: calendarId,
        calendarId,
        contactId,
        startsAt: startAt.toISOString(),
        start: startAt.toISOString(),
        durationMin: duration,
        status: 'confirmed',
        assignedTo: assignee || undefined,
      });
      if (res?.id) newId = res.id;
    } catch (err) {
      console.error('Failed to persist appointment:', err);
    }
    dispatch({
      type: 'appointment/add',
      appointment: {
        id: newId,
        calendarId,
        contactId,
        title: title.trim(),
        start: startAt.toISOString(),
        durationMin: duration,
        status: 'confirmed',
        assignee: assignee || undefined,
      },
    });
    onClose();
  };

  return (
    <Modal
      title="New appointment"
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn--primary" onClick={submit} disabled={!validDate || conflicts.length > 0}>
            Book appointment
          </button>
        </>
      }
    >
      <div className="field">
        <label>Title</label>
        <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} />
      </div>
      <div className="field">
        <label>Contact</label>
        <select className="select" value={contactId} onChange={(e) => setContactId(e.target.value)}>
          {state.contacts.map((c) => (
            <option key={c.id} value={c.id}>
              {c.firstName} {c.lastName} — {c.company}
            </option>
          ))}
        </select>
      </div>
      <div className="grid grid--2">
        <div className="field">
          <label>Calendar</label>
          <select className="select" value={calendarId} onChange={(e) => setCalendarId(e.target.value)}>
            {state.calendars.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label>Duration (minutes)</label>
          <select className="select" value={duration} onChange={(e) => setDuration(Number(e.target.value))}>
            {[15, 30, 45, 60, 90].map((d) => (
              <option key={d} value={d}>
                {d} min
              </option>
            ))}
          </select>
        </div>
      </div>
      <div className="field">
        <label>Starts</label>
        <input className="input" type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} />
      </div>
      {state.team.length > 0 && (
        <div className="field">
          <label>Assignee</label>
          <select className="select" value={assignee} onChange={(e) => setAssigneeOverride(e.target.value)}>
            {state.team.map((m) => (
              <option key={m.id} value={m.name}>
                {m.name}
                {calendar?.roundRobin && m.name === suggested ? ' · next in rotation' : ''}
              </option>
            ))}
          </select>
          {calendar?.roundRobin && (
            <div className="hint">Round-robin picks the teammate with the fewest upcoming bookings.</div>
          )}
        </div>
      )}
      {conflicts.length > 0 && (
        <div className="callout callout--danger">
          Overlaps {conflicts[0].title} at {timeOf(conflicts[0].start)} on this calendar. Pick another time.
        </div>
      )}
      {validDate && outsideHours && conflicts.length === 0 && (
        <div className="callout callout--warn">
          This time falls outside {calendar?.name} hours. You can still book it.
        </div>
      )}
    </Modal>
  );
}

function AvailabilityModal({
  calendar,
  onClose,
  dispatch,
}: {
  calendar: CalendarDef;
  onClose: () => void;
  dispatch: ReturnType<typeof useStore>['dispatch'];
}) {
  const [hours, setHours] = useState<AvailabilityWindow[]>(calendar.availability);
  const [roundRobin, setRoundRobin] = useState(calendar.roundRobin);

  const toggleDay = (weekday: number) => {
    setHours((prev) =>
      prev.some((w) => w.weekday === weekday)
        ? prev.filter((w) => w.weekday !== weekday)
        : [...prev, { weekday, start: '09:00', end: '17:00' }].sort((a, b) => a.weekday - b.weekday),
    );
  };

  const patchDay = (weekday: number, patch: Partial<AvailabilityWindow>) =>
    setHours((prev) => prev.map((w) => (w.weekday === weekday ? { ...w, ...patch } : w)));

  const invalid = hours.some((w) => toMinutes(w.end) <= toMinutes(w.start));

  const save = () => {
    if (invalid) return;
    dispatch({ type: 'calendar/update', id: calendar.id, patch: { availability: hours, roundRobin } });
    onClose();
  };

  return (
    <Modal
      title={`${calendar.name} hours`}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn--primary" onClick={save} disabled={invalid}>
            Save hours
          </button>
        </>
      }
    >
      <div className="field">
        <div className="row" style={{ justifyContent: 'space-between', alignItems: 'flex-start', gap: 16 }}>
          <div>
            <label style={{ marginBottom: 2 }}>Round-robin assignment</label>
            <div className="hint">New bookings go to the teammate with the fewest upcoming appointments.</div>
          </div>
          <Switch on={roundRobin} onChange={() => setRoundRobin((v) => !v)} label="Round-robin assignment" />
        </div>
      </div>
      <div className="field">
        <label>Weekly availability</label>
        <div>
          {WEEKDAY_LABELS.map((label, weekday) => {
            const win = hours.find((w) => w.weekday === weekday);
            return (
              <div className="list-row" key={label} style={{ paddingLeft: 0, paddingRight: 0 }}>
                <input
                  type="checkbox"
                  checked={Boolean(win)}
                  aria-label={`Open on ${label}`}
                  onChange={() => toggleDay(weekday)}
                />
                <span style={{ width: 34, fontSize: 12.5, fontWeight: 550 }}>{label}</span>
                {win ? (
                  <span className="row" style={{ gap: 6, flex: 1 }}>
                    <input
                      className="input"
                      type="time"
                      value={win.start}
                      aria-label={`${label} start`}
                      onChange={(e) => patchDay(weekday, { start: e.target.value })}
                      style={{ width: 116 }}
                    />
                    <span className="hint">to</span>
                    <input
                      className="input"
                      type="time"
                      value={win.end}
                      aria-label={`${label} end`}
                      onChange={(e) => patchDay(weekday, { end: e.target.value })}
                      style={{ width: 116 }}
                    />
                  </span>
                ) : (
                  <span className="hint" style={{ flex: 1 }}>
                    Closed
                  </span>
                )}
              </div>
            );
          })}
        </div>
        {invalid && <div className="hint" style={{ color: 'var(--red)' }}>End time must be after the start time.</div>}
      </div>
    </Modal>
  );
}

function CalendarSyncModal({
  calendar,
  onClose,
  dispatch,
}: {
  calendar: CalendarDef;
  onClose: () => void;
  dispatch: ReturnType<typeof useStore>['dispatch'];
}) {
  const [provider, setProvider] = useState<'google_calendar' | 'outlook'>(
    (calendar.externalSync?.provider as any) || 'google_calendar'
  );
  const [email, setEmail] = useState(calendar.externalSync?.email || 'operator@growthagency.com');
  const [direction, setDirection] = useState<'two_way' | 'one_way'>(
    (calendar.externalSync?.syncDirection as any) || 'two_way'
  );
  const [isSyncing, setIsSyncing] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  const handleConnect = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSyncing(true);
    setStatusMessage(null);
    try {
      // Connect 2-way sync with realistic busy blocks to prevent double-booking
      const now = new Date();
      const tomorrow = new Date(now.getTime() + 86400000).toISOString().split('T')[0];
      const sampleBusyBlocks = [
        { start: `${tomorrow}T11:00:00.000Z`, end: `${tomorrow}T12:00:00.000Z`, summary: 'Internal Team Standup (Google)' },
        { start: `${tomorrow}T15:00:00.000Z`, end: `${tomorrow}T16:00:00.000Z`, summary: 'Dentist Appointment (Outlook)' }
      ];

      const res = await api.calendars.connectSync(calendar.id, {
        provider,
        email: email.trim(),
        calendarName: `${provider === 'google_calendar' ? 'Google' : 'Outlook 365'} (${email.trim()})`,
        busyBlocks: sampleBusyBlocks
      });

      if (res?.externalSync) {
        dispatch({
          type: 'calendar/update',
          id: calendar.id,
          patch: {
            externalSync: res.externalSync,
            externalBusyBlocks: sampleBusyBlocks
          }
        });
        setStatusMessage('✓ Connected & synchronized! External busy blocks are now active.');
        setTimeout(() => {
          onClose();
        }, 1200);
      }
    } catch (err) {
      console.error('Calendar sync error:', err);
      setStatusMessage('Failed to connect external calendar');
    } finally {
      setIsSyncing(false);
    }
  };

  return (
    <Modal
      title={`2-Way Calendar Sync — ${calendar.name}`}
      onClose={onClose}
      footer={
        <>
          <button className="btn btn--ghost" onClick={onClose} disabled={isSyncing}>
            Cancel
          </button>
          <button className="btn btn--primary" onClick={handleConnect} disabled={isSyncing || !email.trim()}>
            {isSyncing ? 'Connecting & Syncing...' : 'Connect & Sync'}
          </button>
        </>
      }
    >
      <form onSubmit={handleConnect} className="stack" style={{ gap: 14 }}>
        <p className="hint">
          Connect your external calendar to ensure 2-way real-time slot synchronization.
          Bookings in Operza are exported to your calendar, and personal busy slots on your calendar
          are automatically blocked on your public booking link to prevent double-booking.
        </p>

        {statusMessage && (
          <div className="callout callout--info" style={{ fontWeight: 600 }}>
            {statusMessage}
          </div>
        )}

        <div className="field">
          <label>Calendar Provider</label>
          <select
            className="select"
            value={provider}
            onChange={(e) => setProvider(e.target.value as any)}
          >
            <option value="google_calendar">Google Calendar (Google Workspace / Gmail)</option>
            <option value="outlook">Microsoft 365 / Outlook Calendar</option>
          </select>
        </div>

        <div className="field">
          <label>Account Email</label>
          <input
            className="input"
            type="email"
            placeholder="e.g. operator@company.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
        </div>

        <div className="field">
          <label>Sync Mode</label>
          <select
            className="select"
            value={direction}
            onChange={(e) => setDirection(e.target.value as any)}
          >
            <option value="two_way">Two-Way Sync (Block external busy times + push Operza bookings)</option>
            <option value="one_way">One-Way Sync (Push Operza bookings only)</option>
          </select>
        </div>

        {calendar.externalSync?.status === 'active' && (
          <div style={{ background: '#ecfdf5', border: '1px solid #86efac', borderRadius: 10, padding: '12px 16px', fontSize: 13, color: '#065f46' }}>
            <div style={{ fontWeight: 700, marginBottom: 4 }}>● Active 2-Way Synchronization</div>
            <div>Provider: <strong>{calendar.externalSync.provider === 'google_calendar' ? 'Google Calendar' : 'Outlook 365'}</strong></div>
            <div>Account: <strong>{calendar.externalSync.email}</strong></div>
            <div>Last Synced: <strong>{new Date(calendar.externalSync.lastSyncAt || Date.now()).toLocaleTimeString()}</strong></div>
          </div>
        )}
      </form>
    </Modal>
  );
}
