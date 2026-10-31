import { useEffect, useState } from 'react';
import { Icon } from '../components/Icon';
import { Modal } from '../components/Modal';
import { Avatar, Badge, EmptyState, PageHeader, StatCard, Switch } from '../components/ui';
import { relative, sameDay, toDateTimeInput } from '../lib/format';
import { uid, useStore } from '../lib/store';
import { api } from '../lib/api';
import type { CallDirection, CallOutcome, CallRecord, PhoneNumber } from '../lib/types';

const OUTCOME_META: Record<CallOutcome, { label: string; tone: 'green' | 'amber' | 'red' }> = {
  completed: { label: 'Completed', tone: 'green' },
  missed: { label: 'Missed', tone: 'red' },
  voicemail: { label: 'Voicemail', tone: 'amber' },
};

const DIRECTION_META: Record<CallDirection, { label: string; icon: string }> = {
  inbound: { label: 'Inbound', icon: 'arrow-down' },
  outbound: { label: 'Outbound', icon: 'arrow-up' },
};

function talkTime(seconds: number): string {
  return `${Math.floor(seconds / 60)}m ${String(seconds % 60).padStart(2, '0')}s`;
}

export default function PhoneSystem() {
  const { state, dispatch } = useStore();
  const [direction, setDirection] = useState<'all' | CallDirection>('all');
  const [outcome, setOutcome] = useState<'all' | CallOutcome>('all');
  const [query, setQuery] = useState('');
  const [logging, setLogging] = useState(false);
  const [provisioning, setProvisioning] = useState(false);
  const [editingNumber, setEditingNumber] = useState<PhoneNumber | null>(null);

  useEffect(() => {
    api.crm.list<CallRecord>('calls').then((res) => {
      if (res.data && res.data.length > 0) {
        for (const call of res.data) {
          if (!state.calls.some((x) => x.id === call.id)) {
            dispatch({ type: 'call/log', call });
          }
        }
      }
    }).catch(() => { /* dev fallback */ });

    api.crm.list<PhoneNumber>('phoneNumbers').then((res) => {
      if (res.data && res.data.length > 0) {
        for (const num of res.data) {
          if (!state.phoneNumbers.some((x) => x.id === num.id)) {
            dispatch({ type: 'number/add', number: num });
          }
        }
      }
    }).catch(() => { /* dev fallback */ });
  }, []);

  const handleToggleHandled = async (id: string, currentlyHandled = false) => {
    dispatch({ type: 'call/handled', id });
    try {
      await api.calls.setHandled(id, !currentlyHandled);
    } catch { /* dev fallback */ }
  };

  const contactOf = (id: string) => state.contacts.find((c) => c.id === id);
  const nameOf = (id: string) => {
    const c = contactOf(id);
    return c ? `${c.firstName} ${c.lastName}` : 'Unknown contact';
  };
  const lineOf = (id: string) => state.phoneNumbers.find((n) => n.id === id)?.label ?? 'Unassigned';

  const now = new Date();
  const callsToday = state.calls.filter((c) => sameDay(new Date(c.startedAt), now));
  const inbound = state.calls.filter((c) => c.direction === 'inbound');
  const answered = inbound.filter((c) => c.outcome === 'completed');
  const completed = state.calls.filter((c) => c.outcome === 'completed');
  const avgTalk = completed.length
    ? Math.round(completed.reduce((sum, c) => sum + c.durationSec, 0) / completed.length)
    : 0;
  const followUps = state.calls.filter((c) => c.outcome !== 'completed' && !c.handled);

  const q = query.trim().toLowerCase();
  const rows = [...state.calls]
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt))
    .filter((call) => {
      if (direction !== 'all' && call.direction !== direction) return false;
      if (outcome !== 'all' && call.outcome !== outcome) return false;
      if (!q) return true;
      const contact = contactOf(call.contactId);
      return `${contact?.firstName ?? ''} ${contact?.lastName ?? ''} ${contact?.company ?? ''} ${contact?.email ?? ''} ${contact?.phone ?? ''} ${lineOf(call.numberId)} ${call.notes ?? ''}`
        .toLowerCase()
        .includes(q);
    });

  return (
    <div className="content">
      <PageHeader
        title="Phone System"
        subtitle="Manage virtual business lines, IVR call routing, voicemail, and omni-channel telephony logs."
        actions={
          <div className="row" style={{ gap: 8 }}>
            <button className="btn" onClick={() => setLogging(true)}>
              <Icon name="phone" size={15} /> Log a call
            </button>
            <button className="btn btn--primary" onClick={() => setProvisioning(true)}>
              <Icon name="plus" size={15} /> Provision number
            </button>
          </div>
        }
      />

      <div className="grid grid--4" style={{ marginBottom: 16 }}>
        <StatCard
          label="Calls today"
          value={String(callsToday.length)}
          icon={<Icon name="phone" size={15} />}
          meta={`${callsToday.filter((c) => c.direction === 'inbound').length} inbound`}
        />
        <StatCard
          label="Answer rate"
          value={inbound.length ? `${Math.round((answered.length / inbound.length) * 100)}%` : '—'}
          icon={<Icon name="check" size={15} />}
          meta={`${answered.length} of ${inbound.length} inbound`}
        />
        <StatCard
          label="Avg. talk time"
          value={talkTime(avgTalk)}
          icon={<Icon name="clock" size={15} />}
          meta="completed calls"
        />
        <StatCard
          label="Needs follow-up"
          value={String(followUps.length)}
          icon={<Icon name="bell" size={15} />}
          meta="missed or voicemail"
        />
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card__head">
          <div>
            <div className="card__title">Workspace numbers ({state.phoneNumbers.length})</div>
            <div className="card__sub">
              {state.phoneNumbers.filter((n) => n.status === 'active').length} active lines provisioned
            </div>
          </div>
          <button className="btn btn--sm btn--primary" onClick={() => setProvisioning(true)}>
            <Icon name="plus" size={13} /> Buy number
          </button>
        </div>
        <div className="card__body">
          <div className="grid grid--3">
            {state.phoneNumbers.map((number) => (
              <div key={number.id} className="card" style={{ boxShadow: 'none', border: '1px solid var(--border)' }}>
                <div className="card__head">
                  <div style={{ minWidth: 0 }}>
                    <div className="card__title">{number.label}</div>
                    <div className="card__sub mono-cell" style={{ fontWeight: 600 }}>{number.number}</div>
                  </div>
                  <div className="card__actions">
                    <Badge tone={number.type === 'local' ? 'blue' : 'violet'}>
                      {number.type === 'local' ? 'Local' : 'Toll-free'}
                    </Badge>
                  </div>
                </div>
                <div className="card__body stack" style={{ gap: 10 }}>
                  <div className="field">
                    <label htmlFor={`assign-${number.id}`}>Assigned to</label>
                    <select
                      id={`assign-${number.id}`}
                      className="select"
                      value={number.assignedTo}
                      onChange={(e) =>
                        dispatch({
                          type: 'number/update',
                          id: number.id,
                          patch: { assignedTo: e.target.value },
                        })
                      }
                    >
                      {state.team.map((member) => (
                        <option key={member.id} value={member.name}>
                          {member.name}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="row row--between" style={{ fontSize: 12 }}>
                    <span className="cell-sub">Forwarding:</span>
                    <span style={{ fontWeight: 550 }}>{number.forwardTo || 'Direct to Agent'}</span>
                  </div>

                  <div className="row" style={{ gap: 4, flexWrap: 'wrap' }}>
                    {number.voice && <Badge tone="blue">Voice</Badge>}
                    {number.sms && <Badge tone="violet">SMS</Badge>}
                    {number.mms && <Badge tone="accent">MMS</Badge>}
                    {number.ivrEnabled && <Badge tone="green">IVR Menu</Badge>}
                  </div>

                  <div className="row row--between" style={{ borderTop: '1px solid var(--border)', paddingTop: 10 }}>
                    <button
                      type="button"
                      className="btn btn--sm btn--ghost"
                      onClick={() => setEditingNumber(number)}
                    >
                      <Icon name="sliders" size={13} /> Routing
                    </button>
                    <div className="row" style={{ gap: 8 }}>
                      <span className="cell-sub" style={{ fontSize: 11.5 }}>
                        {number.status === 'active' ? 'Active' : 'Inactive'}
                      </span>
                      <Switch
                        on={number.status === 'active'}
                        label={`Toggle ${number.label} status`}
                        onChange={() =>
                          dispatch({
                            type: 'number/update',
                            id: number.id,
                            patch: { status: number.status === 'active' ? 'inactive' : 'active' },
                          })
                        }
                      />
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card__head">
          <div>
            <div className="card__title">Call log</div>
            <div className="card__sub">
              {rows.length} of {state.calls.length} calls
            </div>
          </div>
          <div className="card__actions">
            <div className="search" style={{ width: 190 }}>
              <Icon name="search" size={15} />
              <input
                className="input"
                placeholder="Search calls"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </div>
            <select
              className="select"
              style={{ width: 145 }}
              aria-label="Filter by direction"
              value={direction}
              onChange={(e) => setDirection(e.target.value as 'all' | CallDirection)}
            >
              <option value="all">All directions</option>
              <option value="inbound">Inbound</option>
              <option value="outbound">Outbound</option>
            </select>
            <select
              className="select"
              style={{ width: 140 }}
              aria-label="Filter by outcome"
              value={outcome}
              onChange={(e) => setOutcome(e.target.value as 'all' | CallOutcome)}
            >
              <option value="all">All outcomes</option>
              <option value="completed">Completed</option>
              <option value="missed">Missed</option>
              <option value="voicemail">Voicemail</option>
            </select>
          </div>
        </div>

        {rows.length === 0 ? (
          <EmptyState
            icon={<Icon name="phone" size={22} />}
            title={state.calls.length === 0 ? 'No calls logged' : 'No matching calls'}
            text={
              state.calls.length === 0
                ? 'Log a call to start tracking conversations and follow-ups.'
                : 'Try a different direction, outcome or search term.'
            }
            action={
              state.calls.length === 0 ? (
                <button className="btn btn--sm" onClick={() => setLogging(true)}>
                  Log a call
                </button>
              ) : undefined
            }
          />
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Contact</th>
                  <th>Direction</th>
                  <th>Line</th>
                  <th>Outcome</th>
                  <th>Talk time</th>
                  <th>Started</th>
                  <th>Follow-up</th>
                  <th style={{ width: 44 }} />
                </tr>
              </thead>
              <tbody>
                {rows.map((call) => {
                  const contact = contactOf(call.contactId);
                  return (
                    <tr key={call.id}>
                      <td>
                        <div className="row" style={{ gap: 8 }}>
                          <Avatar name={contact ? `${contact.firstName} ${contact.lastName}` : 'Unknown'} size="xs" />
                          <div style={{ minWidth: 0 }}>
                            <div style={{ fontSize: 13, fontWeight: 550 }}>{nameOf(call.contactId)}</div>
                            <div className="cell-sub">
                              {contact?.company || contact?.phone || '—'}
                              {call.notes ? ` · ${call.notes}` : ''}
                            </div>
                          </div>
                        </div>
                      </td>
                      <td>
                        <span className="row" style={{ gap: 5 }}>
                          <Icon name={DIRECTION_META[call.direction].icon} size={13} />
                          <span className="cell-sub">{DIRECTION_META[call.direction].label}</span>
                        </span>
                      </td>
                      <td className="cell-sub">{lineOf(call.numberId)}</td>
                      <td>
                        <Badge tone={OUTCOME_META[call.outcome].tone} dot>
                          {OUTCOME_META[call.outcome].label}
                        </Badge>
                      </td>
                      <td className="cell-sub">{call.durationSec ? talkTime(call.durationSec) : '—'}</td>
                      <td className="cell-sub" title={new Date(call.startedAt).toLocaleString()}>
                        {relative(call.startedAt)}
                      </td>
                      <td>
                        {call.outcome === 'completed' ? (
                          <span className="cell-sub">—</span>
                        ) : call.handled ? (
                          <Badge tone="green" dot>
                            Handled
                          </Badge>
                        ) : (
                          <button
                            className="btn btn--sm"
                            onClick={() => handleToggleHandled(call.id, call.handled)}
                          >
                            Mark handled
                          </button>
                        )}
                      </td>
                      <td className="cell-right">
                        <button
                          className="icon-btn"
                          aria-label={`Delete call with ${nameOf(call.contactId)}`}
                          onClick={() => dispatch({ type: 'call/delete', id: call.id })}
                        >
                          <Icon name="trash" size={15} />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {logging && <LogCallModal onClose={() => setLogging(false)} />}
      {provisioning && <ProvisionNumberModal onClose={() => setProvisioning(false)} />}
      {editingNumber && (
        <ConfigureRoutingModal
          number={editingNumber}
          onClose={() => setEditingNumber(null)}
          onSave={(patch) => {
            dispatch({
              type: 'number/update',
              id: editingNumber.id,
              patch,
            });
            api.crm.update('phoneNumbers', editingNumber.id, patch).catch(() => {});
            setEditingNumber(null);
          }}
        />
      )}
    </div>
  );
}

function ProvisionNumberModal({ onClose }: { onClose: () => void }) {
  const { state, dispatch } = useStore();
  const [areaCode, setAreaCode] = useState('415');
  const [label, setLabel] = useState('Primary Advisory Line');
  const [type, setType] = useState<PhoneNumber['type']>('local');
  const [assignedTo, setAssignedTo] = useState(state.team[0]?.name || 'Automated Tester');
  const [voice, setVoice] = useState(true);
  const [sms, setSms] = useState(true);
  const [mms, setMms] = useState(true);
  const [forwardTo, setForwardTo] = useState('+1 (555) 019-9000');
  const [ivrEnabled, setIvrEnabled] = useState(true);
  const [ivrMenu, setIvrMenu] = useState('Press 1 for Advisory Sales, Press 2 for VIP Client Support');
  const [loading, setLoading] = useState(false);

  const generatedPhone = type === 'local' ? `+1 (${areaCode}) ${Math.floor(200 + Math.random() * 700)}-${Math.floor(1000 + Math.random() * 9000)}` : `+1 (800) ${Math.floor(200 + Math.random() * 700)}-${Math.floor(1000 + Math.random() * 9000)}`;

  const handleProvision = async () => {
    setLoading(true);
    const newNumber: PhoneNumber = {
      id: uid('num'),
      number: generatedPhone,
      label: label.trim(),
      type,
      assignedTo,
      status: 'active',
      voice,
      sms,
      mms,
      forwardTo: forwardTo.trim() || undefined,
      ivrEnabled,
      ivrMenu: ivrEnabled ? ivrMenu.trim() : undefined,
      areaCode: type === 'local' ? areaCode : undefined,
    };

    try {
      await api.crm.create('phoneNumbers', newNumber);
    } catch { /* dev fallback */ }

    dispatch({
      type: 'number/add',
      number: newNumber,
    });
    setLoading(false);
    onClose();
  };

  return (
    <Modal
      title="Provision Virtual Phone Number"
      wide
      onClose={onClose}
      footer={
        <>
          <button className="btn" type="button" onClick={onClose}>
            Cancel
          </button>
          <button
            className="btn btn--primary"
            type="button"
            disabled={loading || !label.trim()}
            onClick={handleProvision}
          >
            <Icon name="phone" size={14} /> {loading ? 'Provisioning Line...' : `Activate Line (${generatedPhone})`}
          </button>
        </>
      }
    >
      <div className="grid grid--2" style={{ gap: 14 }}>
        <div className="field">
          <label htmlFor="num-type">Number Classification</label>
          <select
            id="num-type"
            className="select"
            value={type}
            onChange={(e) => setType(e.target.value as PhoneNumber['type'])}
          >
            <option value="local">Local City Number</option>
            <option value="toll-free">Toll-Free (+1 800 / 888)</option>
          </select>
        </div>

        {type === 'local' && (
          <div className="field">
            <label htmlFor="num-area">Area Code / Region</label>
            <select
              id="num-area"
              className="select"
              value={areaCode}
              onChange={(e) => setAreaCode(e.target.value)}
            >
              <option value="415">415 — San Francisco, CA</option>
              <option value="212">212 — New York City, NY</option>
              <option value="312">312 — Chicago, IL</option>
              <option value="512">512 — Austin, TX</option>
              <option value="650">650 — Silicon Valley, CA</option>
              <option value="702">702 — Las Vegas, NV</option>
              <option value="206">206 — Seattle, WA</option>
              <option value="305">305 — Miami, FL</option>
            </select>
          </div>
        )}
      </div>

      <div className="card" style={{ padding: 14, background: 'var(--surface-2)', margin: '14px 0' }}>
        <div className="row row--between">
          <div>
            <div style={{ fontSize: 11, color: 'var(--text-sub)', textTransform: 'uppercase' }}>Selected Line</div>
            <div style={{ fontSize: 18, fontWeight: 700, fontFamily: 'monospace', color: 'var(--accent)' }}>
              {generatedPhone}
            </div>
          </div>
          <Badge tone="green">INSTANT CARRIER ACTIVATION</Badge>
        </div>
      </div>

      <div className="grid grid--2" style={{ gap: 14 }}>
        <div className="field">
          <label htmlFor="num-label">Line friendly label</label>
          <input
            id="num-label"
            className="input"
            value={label}
            placeholder="e.g. Inbound Sales Line"
            onChange={(e) => setLabel(e.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor="num-assign">Default line operator</label>
          <select
            id="num-assign"
            className="select"
            value={assignedTo}
            onChange={(e) => setAssignedTo(e.target.value)}
          >
            {state.team.map((member) => (
              <option key={member.id} value={member.name}>
                {member.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div style={{ marginTop: 14 }}>
        <label style={{ fontSize: 13, fontWeight: 600 }}>Enabled Telephony Capabilities</label>
        <div className="row" style={{ gap: 16, marginTop: 6 }}>
          <label className="row" style={{ gap: 6, cursor: 'pointer' }}>
            <input type="checkbox" checked={voice} onChange={(e) => setVoice(e.target.checked)} />
            <span>Voice Calls</span>
          </label>
          <label className="row" style={{ gap: 6, cursor: 'pointer' }}>
            <input type="checkbox" checked={sms} onChange={(e) => setSms(e.target.checked)} />
            <span>SMS Two-Way</span>
          </label>
          <label className="row" style={{ gap: 6, cursor: 'pointer' }}>
            <input type="checkbox" checked={mms} onChange={(e) => setMms(e.target.checked)} />
            <span>MMS Attachments</span>
          </label>
        </div>
      </div>

      <div className="card" style={{ padding: 14, background: 'var(--surface-2)', marginTop: 16 }}>
        <strong style={{ fontSize: 13 }}>Inbound Call Routing & IVR Setup</strong>
        <div className="field" style={{ marginTop: 10 }}>
          <label htmlFor="num-forward">Forward incoming calls to</label>
          <input
            id="num-forward"
            className="input"
            placeholder="+1 (555) 019-9000"
            value={forwardTo}
            onChange={(e) => setForwardTo(e.target.value)}
          />
        </div>

        <div className="field" style={{ marginTop: 12 }}>
          <label className="row" style={{ gap: 6, cursor: 'pointer' }}>
            <input type="checkbox" checked={ivrEnabled} onChange={(e) => setIvrEnabled(e.target.checked)} />
            <span>Enable Automated Interactive Voice Response (IVR Menu)</span>
          </label>
          {ivrEnabled && (
            <textarea
              className="textarea"
              rows={2}
              style={{ marginTop: 6 }}
              value={ivrMenu}
              placeholder="e.g. Press 1 for Sales, Press 2 for VIP Support"
              onChange={(e) => setIvrMenu(e.target.value)}
            />
          )}
        </div>
      </div>
    </Modal>
  );
}

function ConfigureRoutingModal({
  number,
  onClose,
  onSave,
}: {
  number: PhoneNumber;
  onClose: () => void;
  onSave: (patch: Partial<PhoneNumber>) => void;
}) {
  const { state } = useStore();
  const [label, setLabel] = useState(number.label);
  const [assignedTo, setAssignedTo] = useState(number.assignedTo);
  const [forwardTo, setForwardTo] = useState(number.forwardTo || '');
  const [ivrEnabled, setIvrEnabled] = useState(Boolean(number.ivrEnabled));
  const [ivrMenu, setIvrMenu] = useState(number.ivrMenu || 'Press 1 for Sales, Press 2 for Support');
  const [mms, setMms] = useState(Boolean(number.mms));

  return (
    <Modal
      title={`Configure Routing: ${number.number}`}
      onClose={onClose}
      footer={
        <>
          <button className="btn" type="button" onClick={onClose}>
            Cancel
          </button>
          <button
            className="btn btn--primary"
            type="button"
            onClick={() =>
              onSave({
                label: label.trim(),
                assignedTo,
                forwardTo: forwardTo.trim() || undefined,
                ivrEnabled,
                ivrMenu: ivrEnabled ? ivrMenu.trim() : undefined,
                mms,
              })
            }
          >
            Save Routing Rules
          </button>
        </>
      }
    >
      <div className="field">
        <label htmlFor="edit-num-label">Line Name</label>
        <input
          id="edit-num-label"
          className="input"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
        />
      </div>

      <div className="field" style={{ marginTop: 12 }}>
        <label htmlFor="edit-num-assign">Assigned Agent</label>
        <select
          id="edit-num-assign"
          className="select"
          value={assignedTo}
          onChange={(e) => setAssignedTo(e.target.value)}
        >
          {state.team.map((member) => (
            <option key={member.id} value={member.name}>
              {member.name}
            </option>
          ))}
        </select>
      </div>

      <div className="field" style={{ marginTop: 12 }}>
        <label htmlFor="edit-num-forward">Forward Calls To</label>
        <input
          id="edit-num-forward"
          className="input"
          placeholder="e.g. +1 555-0123"
          value={forwardTo}
          onChange={(e) => setForwardTo(e.target.value)}
        />
      </div>

      <div className="field" style={{ marginTop: 12 }}>
        <label className="row" style={{ gap: 6, cursor: 'pointer' }}>
          <input
            type="checkbox"
            checked={ivrEnabled}
            onChange={(e) => setIvrEnabled(e.target.checked)}
          />
          <span>Enable IVR Digital Receptionist Menu</span>
        </label>
        {ivrEnabled && (
          <textarea
            className="textarea"
            rows={2}
            style={{ marginTop: 6 }}
            value={ivrMenu}
            onChange={(e) => setIvrMenu(e.target.value)}
          />
        )}
      </div>

      <div className="field" style={{ marginTop: 12 }}>
        <label className="row" style={{ gap: 6, cursor: 'pointer' }}>
          <input type="checkbox" checked={mms} onChange={(e) => setMms(e.target.checked)} />
          <span>Support MMS Image/Media Messages</span>
        </label>
      </div>
    </Modal>
  );
}

function LogCallModal({ onClose }: { onClose: () => void }) {
  const { state, dispatch } = useStore();
  const lines = state.phoneNumbers;
  const [contactId, setContactId] = useState(state.contacts[0]?.id ?? '');
  const [numberId, setNumberId] = useState(
    lines.find((n) => n.status === 'active')?.id ?? lines[0]?.id ?? '',
  );
  const [direction, setDirection] = useState<CallDirection>('outbound');
  const [outcome, setOutcome] = useState<CallOutcome>('completed');
  const [startedAt, setStartedAt] = useState(toDateTimeInput(new Date()));
  const [minutes, setMinutes] = useState('4');
  const [seconds, setSeconds] = useState('0');
  const [notes, setNotes] = useState('');

  const mins = Number(minutes);
  const secs = Number(seconds);
  const durationOk =
    outcome === 'missed' ||
    (Number.isInteger(mins) && Number.isInteger(secs) && mins >= 0 && secs >= 0 && secs < 60);
  const startOk = !Number.isNaN(new Date(startedAt).getTime());
  const canSave = Boolean(contactId && numberId && durationOk && startOk);

  const save = async () => {
    const newCall: CallRecord = {
      id: uid('call'),
      contactId,
      numberId,
      direction,
      outcome,
      startedAt: new Date(startedAt).toISOString(),
      durationSec: outcome === 'missed' ? 0 : mins * 60 + secs,
      notes: notes.trim() || undefined,
      handled: outcome === 'completed',
    };
    try {
      const contact = state.contacts.find((c) => c.id === contactId);
      await api.crm.create('calls', {
        from: direction === 'inbound' ? (contact?.phone || '+1 555-0100') : '+1 800-555-0100',
        to: direction === 'inbound' ? '+1 800-555-0100' : (contact?.phone || '+1 555-0100'),
        durationSec: newCall.durationSec,
        outcome: newCall.outcome,
        direction: newCall.direction,
        contactId: newCall.contactId,
        startedAt: newCall.startedAt,
        handled: newCall.handled,
        notes: newCall.notes,
        numberId: newCall.numberId
      });
    } catch { /* dev fallback */ }
    dispatch({
      type: 'call/log',
      call: newCall,
    });
    onClose();
  };

  return (
    <Modal
      title="Log a call"
      onClose={onClose}
      footer={
        <>
          <button className="btn" type="button" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn--primary" type="button" disabled={!canSave} onClick={save}>
            Log call
          </button>
        </>
      }
    >
      <div className="grid grid--2" style={{ gap: 12 }}>
        <div className="field">
          <label htmlFor="call-contact">Contact</label>
          <select
            id="call-contact"
            className="select"
            value={contactId}
            onChange={(e) => setContactId(e.target.value)}
          >
            {state.contacts.map((contact) => (
              <option key={contact.id} value={contact.id}>
                {contact.firstName} {contact.lastName}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="call-number">Workspace number</label>
          <select
            id="call-number"
            className="select"
            value={numberId}
            onChange={(e) => setNumberId(e.target.value)}
          >
            {lines.map((line) => (
              <option key={line.id} value={line.id}>
                {line.label} — {line.number}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="call-direction">Direction</label>
          <select
            id="call-direction"
            className="select"
            value={direction}
            onChange={(e) => setDirection(e.target.value as CallDirection)}
          >
            <option value="outbound">Outbound</option>
            <option value="inbound">Inbound</option>
          </select>
        </div>
        <div className="field">
          <label htmlFor="call-outcome">Outcome</label>
          <select
            id="call-outcome"
            className="select"
            value={outcome}
            onChange={(e) => setOutcome(e.target.value as CallOutcome)}
          >
            <option value="completed">Completed</option>
            <option value="missed">Missed</option>
            <option value="voicemail">Voicemail</option>
          </select>
        </div>
      </div>

      <div className="field" style={{ marginTop: 12 }}>
        <label htmlFor="call-started">Started at</label>
        <input
          id="call-started"
          className="input"
          type="datetime-local"
          value={startedAt}
          onChange={(e) => setStartedAt(e.target.value)}
        />
      </div>

      <div className="field" style={{ marginTop: 12 }}>
        <label>Talk time</label>
        <div className="row">
          <input
            className="input"
            style={{ width: 84 }}
            type="number"
            min={0}
            aria-label="Talk time minutes"
            value={minutes}
            disabled={outcome === 'missed'}
            onChange={(e) => setMinutes(e.target.value)}
          />
          <span className="cell-sub">min</span>
          <input
            className="input"
            style={{ width: 84 }}
            type="number"
            min={0}
            max={59}
            aria-label="Talk time seconds"
            value={seconds}
            disabled={outcome === 'missed'}
            onChange={(e) => setSeconds(e.target.value)}
          />
          <span className="cell-sub">sec</span>
        </div>
        {outcome === 'missed' && (
          <div className="cell-sub" style={{ marginTop: 4 }}>
            Missed calls are logged with a 0s duration.
          </div>
        )}
        {!durationOk && (
          <div className="cell-sub" style={{ marginTop: 4, color: 'var(--red)' }}>
            Use whole minutes and 0–59 seconds.
          </div>
        )}
      </div>

      <div className="field" style={{ marginTop: 12 }}>
        <label htmlFor="call-notes">Notes</label>
        <textarea
          id="call-notes"
          className="textarea"
          rows={3}
          placeholder="What was discussed?"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
        />
      </div>
    </Modal>
  );
}
