import { useState, useEffect, type FormEvent } from 'react';
import { useParams } from 'react-router-dom';
import { api } from '../lib/api';

interface CalendarDetails {
  id: string;
  name: string;
  slug?: string;
  color?: string;
  durationMin: number;
  description?: string;
  availableSlots: string[];
}

export default function PublicBooking() {
  const { id } = useParams<{ id: string }>();
  const [calendar, setCalendar] = useState<CalendarDetails | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // Selected date (defaults to tomorrow)
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const defaultDateStr = tomorrow.toISOString().split('T')[0];

  const [selectedDate, setSelectedDate] = useState<string>(defaultDateStr);
  const [selectedSlot, setSelectedSlot] = useState<string>('');
  const [slots, setSlots] = useState<string[]>([]);

  // Attendee Form
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [notes, setNotes] = useState('');

  const [booking, setBooking] = useState(false);
  const [bookedAppointment, setBookedAppointment] = useState<any | null>(null);

  useEffect(() => {
    if (!id) return;
    setLoading(true);
    api.calendars
      .getPublic(id, selectedDate)
      .then((data) => {
        setCalendar(data);
        setSlots(data.availableSlots || []);
        if (data.availableSlots?.length > 0) {
          setSelectedSlot(data.availableSlots[0]);
        }
        setLoading(false);
      })
      .catch((err) => {
        setError(err.message || 'Calendar not found or unavailable.');
        setLoading(false);
      });
  }, [id, selectedDate]);

  const handleBooking = async (e: FormEvent) => {
    e.preventDefault();
    if (!id || !selectedSlot) return;
    setBooking(true);
    setError('');

    try {
      const res = await api.calendars.bookPublic(id, {
        name,
        email,
        phone,
        date: selectedDate,
        timeSlot: selectedSlot,
        notes
      });
      setBookedAppointment(res.appointment);
    } catch (err: any) {
      setError(err.message || 'Failed to book appointment. Please try again.');
    } finally {
      setBooking(false);
    }
  };

  if (loading) {
    return (
      <div style={styles.centerBox}>
        <div style={styles.spinner} />
        <p style={{ color: 'var(--text-3, #94a3b8)', marginTop: 12 }}>Loading booking calendar…</p>
      </div>
    );
  }

  if (error && !calendar) {
    return (
      <div style={styles.centerBox}>
        <div style={styles.card}>
          <h2 style={{ color: '#ef4444', margin: '0 0 8px 0' }}>Calendar Unavailable</h2>
          <p style={{ color: 'var(--text-3, #94a3b8)', fontSize: 14 }}>{error}</p>
        </div>
      </div>
    );
  }

  if (bookedAppointment) {
    return (
      <div style={styles.centerBox}>
        <div style={{ ...styles.card, maxWidth: 520, textAlign: 'center' }}>
          <div style={styles.checkIcon}>✓</div>
          <h2 style={{ color: 'var(--text-1, #0f172a)', margin: '16px 0 8px 0', fontSize: 24, fontWeight: 700 }}>
            Appointment Confirmed!
          </h2>
          <p style={{ color: 'var(--text-2, #475569)', fontSize: 14, lineHeight: 1.6, marginBottom: 20 }}>
            Your meeting with our team has been scheduled. A confirmation email and calendar invitation have been dispatched to <strong>{email}</strong>.
          </p>

          <div style={styles.detailsBox}>
            <div style={styles.detailRow}>
              <span style={styles.detailLabel}>Session:</span>
              <strong style={styles.detailValue}>{calendar?.name}</strong>
            </div>
            <div style={styles.detailRow}>
              <span style={styles.detailLabel}>Date & Time:</span>
              <strong style={styles.detailValue}>{selectedDate} at {selectedSlot} UTC</strong>
            </div>
            <div style={styles.detailRow}>
              <span style={styles.detailLabel}>Duration:</span>
              <strong style={styles.detailValue}>{calendar?.durationMin || 30} minutes</strong>
            </div>
            <div style={styles.detailRow}>
              <span style={styles.detailLabel}>Host:</span>
              <strong style={styles.detailValue}>{bookedAppointment.assignedTo || 'Operza Growth Team'}</strong>
            </div>
          </div>

          <div style={{ marginTop: 24 }}>
            <span style={{ fontSize: 12, color: 'var(--text-3, #94a3b8)' }}>
              Powered by Operza Autonomous Agency OS
            </span>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={styles.pageContainer}>
      <div style={styles.bookingWrapper}>
        {/* Left Side: Calendar details and slot picker */}
        <div style={styles.calendarInfoPane}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
            <div style={{ width: 12, height: 12, borderRadius: 3, background: calendar?.color || '#6366f1' }} />
            <span style={{ fontSize: 13, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-3, #64748b)', fontWeight: 600 }}>
              Operza Scheduling
            </span>
          </div>

          <h1 style={{ fontSize: 26, fontWeight: 700, color: 'var(--text-1, #0f172a)', margin: '0 0 8px 0', lineHeight: 1.25 }}>
            {calendar?.name}
          </h1>

          <div style={{ display: 'flex', alignItems: 'center', gap: 16, color: 'var(--text-2, #475569)', fontSize: 14, marginBottom: 16 }}>
            <span>⏱️ {calendar?.durationMin || 30} mins</span>
            <span>📹 Google Meet / Zoom</span>
          </div>

          {calendar?.description && (
            <p style={{ color: 'var(--text-2, #64748b)', fontSize: 14, lineHeight: 1.5, marginBottom: 24 }}>
              {calendar.description}
            </p>
          )}

          <div style={{ borderTop: '1px solid var(--border, #e2e8f0)', paddingTop: 20 }}>
            <label style={styles.label}>Select Date</label>
            <input
              type="date"
              value={selectedDate}
              min={new Date().toISOString().split('T')[0]}
              onChange={(e) => setSelectedDate(e.target.value)}
              style={styles.input}
            />

            <label style={{ ...styles.label, marginTop: 16 }}>Available Time (UTC)</label>
            {slots.length === 0 ? (
              <p style={{ fontSize: 13, color: 'var(--text-3, #94a3b8)' }}>No slots available for this date.</p>
            ) : (
              <div style={styles.slotsGrid}>
                {slots.map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => setSelectedSlot(s)}
                    style={{
                      ...styles.slotButton,
                      background: selectedSlot === s ? 'var(--primary, #6366f1)' : 'var(--surface, #ffffff)',
                      color: selectedSlot === s ? '#ffffff' : 'var(--text-1, #0f172a)',
                      borderColor: selectedSlot === s ? 'var(--primary, #6366f1)' : 'var(--border, #cbd5e1)'
                    }}
                  >
                    {s}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Right Side: Contact info & confirm */}
        <div style={styles.bookingFormPane}>
          <h2 style={{ fontSize: 18, fontWeight: 600, color: 'var(--text-1, #0f172a)', margin: '0 0 16px 0' }}>
            Your Details
          </h2>

          {error && (
            <div style={styles.errorBanner}>
              ⚠️ {error}
            </div>
          )}

          <form onSubmit={handleBooking} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div>
              <label style={styles.label}>Your Full Name *</label>
              <input
                type="text"
                required
                placeholder="e.g. Alex Morgan"
                value={name}
                onChange={(e) => setName(e.target.value)}
                style={styles.input}
              />
            </div>

            <div>
              <label style={styles.label}>Email Address *</label>
              <input
                type="email"
                required
                placeholder="alex@acmecorp.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                style={styles.input}
              />
            </div>

            <div>
              <label style={styles.label}>Phone Number</label>
              <input
                type="tel"
                placeholder="+1 (555) 234-5678"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                style={styles.input}
              />
            </div>

            <div>
              <label style={styles.label}>Meeting Agenda / Notes</label>
              <textarea
                rows={3}
                placeholder="What would you like to discuss or accomplish on this call?"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                style={{ ...styles.input, resize: 'vertical' }}
              />
            </div>

            <div style={{ marginTop: 10 }}>
              <button
                type="submit"
                disabled={booking || !selectedSlot}
                style={{
                  ...styles.submitBtn,
                  opacity: booking || !selectedSlot ? 0.7 : 1,
                  cursor: booking || !selectedSlot ? 'not-allowed' : 'pointer'
                }}
              >
                {booking ? 'Securing Booking…' : `Confirm Booking for ${selectedSlot || 'Selected Time'}`}
              </button>
            </div>
          </form>

          <p style={{ fontSize: 12, color: 'var(--text-3, #94a3b8)', marginTop: 16, textAlign: 'center' }}>
            🔒 Free instant booking. No spam. You will receive an automated calendar invite.
          </p>
        </div>
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  pageContainer: {
    minHeight: '100vh',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '24px 16px',
    background: 'var(--bg, #f8fafc)',
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif'
  },
  bookingWrapper: {
    width: '100%',
    maxWidth: 860,
    background: 'var(--card-bg, #ffffff)',
    borderRadius: 12,
    border: '1px solid var(--border, #e2e8f0)',
    boxShadow: '0 10px 25px -5px rgba(0, 0, 0, 0.05), 0 8px 10px -6px rgba(0, 0, 0, 0.05)',
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))',
    overflow: 'hidden'
  },
  calendarInfoPane: {
    padding: '32px 28px',
    borderRight: '1px solid var(--border, #e2e8f0)',
    background: 'var(--surface, #ffffff)'
  },
  bookingFormPane: {
    padding: '32px 28px',
    background: 'var(--surface-alt, #fafbfc)'
  },
  centerBox: {
    minHeight: '100vh',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
    background: 'var(--bg, #f8fafc)',
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif'
  },
  card: {
    width: '100%',
    maxWidth: 480,
    background: 'var(--card-bg, #ffffff)',
    borderRadius: 12,
    padding: '36px 32px',
    border: '1px solid var(--border, #e2e8f0)',
    boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)'
  },
  label: {
    display: 'block',
    fontSize: 13,
    fontWeight: 600,
    color: 'var(--text-1, #1e293b)',
    marginBottom: 6
  },
  input: {
    width: '100%',
    boxSizing: 'border-box',
    padding: '10px 12px',
    borderRadius: 6,
    border: '1px solid var(--border, #cbd5e1)',
    background: 'var(--surface, #ffffff)',
    color: 'var(--text-1, #0f172a)',
    fontSize: 14,
    outline: 'none',
    transition: 'border-color 0.15s ease'
  },
  slotsGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(70px, 1fr))',
    gap: 8,
    marginTop: 8
  },
  slotButton: {
    padding: '8px 4px',
    borderRadius: 6,
    border: '1px solid',
    fontSize: 13,
    fontWeight: 600,
    cursor: 'pointer',
    transition: 'all 0.15s ease'
  },
  submitBtn: {
    width: '100%',
    padding: '12px 16px',
    borderRadius: 6,
    border: 'none',
    background: 'var(--primary, #6366f1)',
    color: '#ffffff',
    fontSize: 14,
    fontWeight: 600,
    transition: 'background 0.15s ease'
  },
  errorBanner: {
    background: '#fef2f2',
    color: '#b91c1c',
    padding: '10px 14px',
    borderRadius: 6,
    fontSize: 13,
    marginBottom: 14,
    border: '1px solid #fecaca'
  },
  checkIcon: {
    width: 56,
    height: 56,
    borderRadius: '50%',
    background: '#dcfce7',
    color: '#16a34a',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: 28,
    fontWeight: 'bold'
  },
  spinner: {
    width: 32,
    height: 32,
    border: '3px solid var(--border, #e2e8f0)',
    borderTopColor: 'var(--primary, #6366f1)',
    borderRadius: '50%',
    animation: 'spin 0.8s linear infinite'
  },
  detailsBox: {
    background: 'var(--surface-alt, #f8fafc)',
    borderRadius: 8,
    border: '1px solid var(--border, #e2e8f0)',
    padding: '16px 20px',
    textAlign: 'left'
  },
  detailRow: {
    display: 'flex',
    justifyContent: 'space-between',
    padding: '6px 0',
    fontSize: 13
  },
  detailLabel: {
    color: 'var(--text-3, #64748b)'
  },
  detailValue: {
    color: 'var(--text-1, #0f172a)'
  }
};
