import { useEffect, useState, useMemo } from 'react';
import { Icon } from '../components/Icon';
import { Modal } from '../components/Modal';
import { Badge, EmptyState, PageHeader, StatCard, StatusBadge } from '../components/ui';
import { api } from '../lib/api';

interface ConsentRecord {
  id: string;
  agencyId: string;
  locationId: string;
  contactId: string;
  channel: 'email' | 'sms' | 'whatsapp';
  purpose: 'transactional' | 'marketing' | 'appointment' | 'review_request';
  status: 'granted' | 'revoked';
  source: 'web_form' | 'api' | 'keyword_opt_out' | 'manual' | 'import';
  proofRef?: string;
  capturedAt: string;
  revokedAt?: string;
}

export default function ConsentLedger() {
  const [consents, setConsents] = useState<ConsentRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [channelFilter, setChannelFilter] = useState<string>('all');
  const [purposeFilter, setPurposeFilter] = useState<string>('all');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [search, setSearch] = useState('');
  
  // Record modal state
  const [showRecordModal, setShowRecordModal] = useState(false);
  const [contactIdInput, setContactIdInput] = useState('');
  const [channelInput, setChannelInput] = useState<'email' | 'sms' | 'whatsapp'>('email');
  const [purposeInput, setPurposeInput] = useState<'transactional' | 'marketing' | 'appointment' | 'review_request'>('marketing');
  const [statusInput, setStatusInput] = useState<'granted' | 'revoked'>('granted');
  const [sourceInput, setSourceInput] = useState<'web_form' | 'api' | 'keyword_opt_out' | 'manual' | 'import'>('web_form');
  const [proofRefInput, setProofRefInput] = useState('');
  const [saving, setSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Revoke confirmation modal state
  const [revokingRecord, setRevokingRecord] = useState<ConsentRecord | null>(null);

  const fetchConsents = async () => {
    setLoading(true);
    try {
      const res = await api.platform.listConsents();
      setConsents(res.data || []);
    } catch (err: any) {
      console.error('Failed to load consents', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchConsents();
  }, []);

  const filteredConsents = useMemo(() => {
    return consents.filter((c) => {
      if (channelFilter !== 'all' && c.channel !== channelFilter) return false;
      if (purposeFilter !== 'all' && c.purpose !== purposeFilter) return false;
      if (statusFilter !== 'all' && c.status !== statusFilter) return false;
      if (search.trim()) {
        const q = search.toLowerCase();
        const matchesContact = c.contactId.toLowerCase().includes(q);
        const matchesProof = c.proofRef ? c.proofRef.toLowerCase().includes(q) : false;
        if (!matchesContact && !matchesProof) return false;
      }
      return true;
    });
  }, [consents, channelFilter, purposeFilter, statusFilter, search]);

  const handleRecordSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!contactIdInput.trim()) {
      setErrorMsg('Contact ID is required');
      return;
    }
    if (statusInput === 'granted' && !proofRefInput.trim()) {
      setErrorMsg('Proof reference is required for granted consent');
      return;
    }

    setSaving(true);
    setErrorMsg(null);
    try {
      await api.platform.recordConsent({
        contactId: contactIdInput.trim(),
        channel: channelInput,
        purpose: purposeInput,
        status: statusInput,
        source: sourceInput,
        proofRef: proofRefInput.trim() || undefined,
      });
      setShowRecordModal(false);
      setContactIdInput('');
      setProofRefInput('');
      await fetchConsents();
    } catch (err: any) {
      setErrorMsg(err.message || 'Failed to record consent');
    } finally {
      setSaving(false);
    }
  };

  const handleRevokeConsent = async () => {
    if (!revokingRecord) return;
    setSaving(true);
    try {
      await api.platform.revokeConsent(revokingRecord.id);
      setRevokingRecord(null);
      await fetchConsents();
    } catch (err: any) {
      alert(err.message || 'Failed to revoke consent');
    } finally {
      setSaving(false);
    }
  };

  const grantedCount = consents.filter((c) => c.status === 'granted').length;
  const revokedCount = consents.filter((c) => c.status === 'revoked').length;

  return (
    <div className="page-container space-y-6">
      <PageHeader
        title="Communication Consent Ledger"
        subtitle="Immutable tenant-scoped evidence ledger for recipient communication consent, channels, and opt-outs."
        actions={
          <button
            onClick={() => {
              setErrorMsg(null);
              setShowRecordModal(true);
            }}
            className="btn btn--primary flex items-center gap-2"
          >
            <Icon name="plus" size={16} />
            Record Consent Evidence
          </button>
        }
      />

      <div className="bg-amber-500/10 border border-amber-500/30 rounded-xl p-4 flex items-start gap-3">
        <Icon name="shield" size={20} className="text-amber-500 mt-0.5 flex-shrink-0" />
        <div className="text-sm">
          <p className="font-semibold text-amber-900 dark:text-amber-200">
            Consent Policy Guard Active
          </p>
          <p className="text-amber-800/90 dark:text-amber-300/90 mt-1">
            Operza enforces explicit, current recipient authorization per channel (Email, SMS, WhatsApp) and purpose (Marketing, Transactional, Appointment, Review). Missing or revoked consent strictly prevents outbound delivery. Revocation appends an audit event and never destroys evidence history.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <StatCard
          label="Total Consent Records"
          value={String(consents.length)}
          icon={<Icon name="clipboard" size={16} />}
        />
        <StatCard
          label="Active Grants"
          value={String(grantedCount)}
          icon={<Icon name="check" size={16} />}
          trend={{ value: `${grantedCount} Active`, direction: 'up' }}
        />
        <StatCard
          label="Revoked / Opt-Outs"
          value={String(revokedCount)}
          icon={<Icon name="x" size={16} />}
          trend={{ value: `${revokedCount} Revoked`, direction: 'down' }}
        />
      </div>

      <div className="card p-4 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex flex-wrap items-center gap-3">
            <div className="relative">
              <Icon name="search" size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                type="text"
                placeholder="Search contact or proof ref..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="input pl-9 text-sm w-64"
              />
            </div>

            <select
              value={channelFilter}
              onChange={(e) => setChannelFilter(e.target.value)}
              className="input text-sm"
            >
              <option value="all">All Channels</option>
              <option value="email">Email</option>
              <option value="sms">SMS</option>
              <option value="whatsapp">WhatsApp</option>
            </select>

            <select
              value={purposeFilter}
              onChange={(e) => setPurposeFilter(e.target.value)}
              className="input text-sm"
            >
              <option value="all">All Purposes</option>
              <option value="transactional">Transactional</option>
              <option value="marketing">Marketing</option>
              <option value="appointment">Appointment</option>
              <option value="review_request">Review Request</option>
            </select>

            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="input text-sm"
            >
              <option value="all">All Statuses</option>
              <option value="granted">Granted</option>
              <option value="revoked">Revoked</option>
            </select>
          </div>

          <button
            onClick={fetchConsents}
            className="btn btn--sm flex items-center gap-1.5"
            disabled={loading}
          >
            <Icon name="refresh" size={14} className={loading ? 'animate-spin' : ''} />
            Refresh
          </button>
        </div>

        {loading ? (
          <div className="py-12 text-center text-gray-400">Loading consent ledger...</div>
        ) : filteredConsents.length === 0 ? (
          <EmptyState
            icon={<Icon name="shield" size={32} />}
            title="No consent records found"
            text="No matching consent evidence entries exist for the selected filters."
            action={
              <button
                onClick={() => setShowRecordModal(true)}
                className="btn btn--primary btn--sm"
              >
                Record First Entry
              </button>
            }
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="table w-full text-left text-sm">
              <thead>
                <tr className="border-b border-gray-200 dark:border-gray-800 text-gray-500">
                  <th className="py-3 px-4">Contact Ref</th>
                  <th className="py-3 px-4">Channel</th>
                  <th className="py-3 px-4">Purpose</th>
                  <th className="py-3 px-4">Status</th>
                  <th className="py-3 px-4">Source</th>
                  <th className="py-3 px-4">Proof Reference</th>
                  <th className="py-3 px-4">Captured At</th>
                  <th className="py-3 px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200 dark:divide-gray-800">
                {filteredConsents.map((item) => (
                  <tr key={item.id} className="hover:bg-gray-50/50 dark:hover:bg-gray-800/40">
                    <td className="py-3 px-4 font-mono text-xs text-gray-900 dark:text-gray-100">
                      {item.contactId}
                    </td>
                    <td className="py-3 px-4">
                      <span className="capitalize font-medium text-gray-700 dark:text-gray-300">
                        {item.channel}
                      </span>
                    </td>
                    <td className="py-3 px-4">
                      <Badge tone="default">
                        {item.purpose.replace('_', ' ')}
                      </Badge>
                    </td>
                    <td className="py-3 px-4">
                      <StatusBadge
                        status={item.status === 'granted' ? 'active' : 'cancelled'}
                      />
                    </td>
                    <td className="py-3 px-4 text-xs text-gray-500">
                      {item.source}
                    </td>
                    <td className="py-3 px-4 font-mono text-xs text-gray-600 dark:text-gray-400">
                      {item.proofRef || '—'}
                    </td>
                    <td className="py-3 px-4 text-xs text-gray-500">
                      {new Date(item.capturedAt).toLocaleString()}
                    </td>
                    <td className="py-3 px-4 text-right">
                      {item.status === 'granted' ? (
                        <button
                          onClick={() => setRevokingRecord(item)}
                          className="btn btn--sm text-xs text-red-500 hover:bg-red-500/10"
                          title="Record opt-out revocation"
                        >
                          Revoke Opt-out
                        </button>
                      ) : (
                        <span className="text-xs text-gray-400">Revoked</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Record Consent Modal */}
      {showRecordModal && (
        <Modal
          title="Record Communication Consent"
          onClose={() => setShowRecordModal(false)}
        >
          <form onSubmit={handleRecordSubmit} className="space-y-4">
            {errorMsg && (
              <div className="p-3 bg-red-500/10 border border-red-500/20 rounded text-red-500 text-xs">
                {errorMsg}
              </div>
            )}

            <div>
              <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1">
                Contact ID or Reference *
              </label>
              <input
                type="text"
                required
                value={contactIdInput}
                onChange={(e) => setContactIdInput(e.target.value)}
                placeholder="UUID or customer reference"
                className="input w-full text-sm font-mono"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1">
                  Channel *
                </label>
                <select
                  value={channelInput}
                  onChange={(e: any) => setChannelInput(e.target.value)}
                  className="input w-full text-sm"
                >
                  <option value="email">Email</option>
                  <option value="sms">SMS</option>
                  <option value="whatsapp">WhatsApp</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1">
                  Purpose *
                </label>
                <select
                  value={purposeInput}
                  onChange={(e: any) => setPurposeInput(e.target.value)}
                  className="input w-full text-sm"
                >
                  <option value="marketing">Marketing</option>
                  <option value="transactional">Transactional</option>
                  <option value="appointment">Appointment</option>
                  <option value="review_request">Review Request</option>
                </select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1">
                  Consent Status *
                </label>
                <select
                  value={statusInput}
                  onChange={(e: any) => setStatusInput(e.target.value)}
                  className="input w-full text-sm"
                >
                  <option value="granted">Granted</option>
                  <option value="revoked">Revoked (Opt-out)</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1">
                  Source *
                </label>
                <select
                  value={sourceInput}
                  onChange={(e: any) => setSourceInput(e.target.value)}
                  className="input w-full text-sm"
                >
                  <option value="web_form">Web Form Submission</option>
                  <option value="api">Backend API</option>
                  <option value="keyword_opt_out">Carrier STOP Keyword</option>
                  <option value="manual">Operator Manual Entry</option>
                  <option value="import">Verified CRM Import</option>
                </select>
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1">
                Proof Reference {statusInput === 'granted' ? '*' : '(Optional)'}
              </label>
              <input
                type="text"
                value={proofRefInput}
                onChange={(e) => setProofRefInput(e.target.value)}
                placeholder="e.g. form_submission:f_98124 or double_optin_token:xyz"
                className="input w-full text-sm font-mono"
              />
              <p className="text-xs text-gray-400 mt-1">
                Auditable citation showing where and how the recipient consented.
              </p>
            </div>

            <div className="flex justify-end gap-3 pt-4 border-t border-gray-200 dark:border-gray-800">
              <button
                type="button"
                onClick={() => setShowRecordModal(false)}
                className="btn btn--sm"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={saving}
                className="btn btn--primary btn--sm flex items-center gap-1.5"
              >
                {saving && <Icon name="refresh" size={14} className="animate-spin" />}
                Record Evidence
              </button>
            </div>
          </form>
        </Modal>
      )}

      {/* Revoke Confirmation Modal */}
      {revokingRecord && (
        <Modal
          title="Revoke Communication Consent"
          onClose={() => setRevokingRecord(null)}
        >
          <div className="space-y-4">
            <p className="text-sm text-gray-600 dark:text-gray-300">
              Are you sure you want to record an opt-out revocation for contact{' '}
              <span className="font-mono font-semibold">{revokingRecord.contactId}</span> on channel{' '}
              <span className="font-semibold uppercase">{revokingRecord.channel}</span> ({revokingRecord.purpose})?
            </p>
            <div className="p-3 bg-red-500/10 border border-red-500/20 rounded text-xs text-red-600 dark:text-red-400">
              This action appends a new revocation record to the audit ledger. The contact will be immediately blocked from receiving outbound communications on this channel.
            </div>
            <div className="flex justify-end gap-3 pt-4 border-t border-gray-200 dark:border-gray-800">
              <button
                type="button"
                onClick={() => setRevokingRecord(null)}
                className="btn btn--sm"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={saving}
                onClick={handleRevokeConsent}
                className="btn btn--danger btn--sm flex items-center gap-1.5"
              >
                {saving && <Icon name="refresh" size={14} className="animate-spin" />}
                Confirm Opt-out
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
