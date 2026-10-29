import { useState, useEffect } from 'react';
import { Icon } from '../components/Icon';
import { Modal } from '../components/Modal';
import { Badge, PageHeader, StatCard, StatusBadge, Switch } from '../components/ui';
import { useStore, uid } from '../lib/store';
import { num, pct, shortDate } from '../lib/format';
import { api } from '../lib/api';
import type { FormCompletion, FormDef, FormField, FormFieldType, FormKind } from '../lib/types';

const TABS: Array<{ value: 'all' | FormKind; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'form', label: 'Forms' },
  { value: 'survey', label: 'Surveys' },
];

const FIELD_TYPES: Array<{ value: FormFieldType; label: string; icon: string }> = [
  { value: 'text', label: 'Short text', icon: 'file' },
  { value: 'email', label: 'Email', icon: 'mail' },
  { value: 'phone', label: 'Phone', icon: 'phone' },
  { value: 'textarea', label: 'Long text', icon: 'file' },
  { value: 'select', label: 'Dropdown', icon: 'sliders' },
  { value: 'consent', label: 'Consent checkbox', icon: 'check' },
];

function labelFor(type: FormFieldType): string {
  return FIELD_TYPES.find((t) => t.value === type)?.label ?? type;
}

function iconFor(type: FormFieldType): string {
  return FIELD_TYPES.find((t) => t.value === type)?.icon ?? 'file';
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
}

function parseOptions(value: string): string[] {
  return value
    .split(',')
    .map((option) => option.trim())
    .filter(Boolean);
}

export default function Forms() {
  const { state, dispatch } = useStore();
  const [tab, setTab] = useState<'all' | FormKind>('all');
  const [creating, setCreating] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [viewingSubmissionsId, setViewingSubmissionsId] = useState<string | null>(null);

  useEffect(() => {
    api.crm.list<FormDef>('forms').then((res) => {
      if (res.data && res.data.length > 0) {
        for (const f of res.data) {
          if (!state.forms.some((x) => x.id === f.id)) {
            dispatch({ type: 'form/add', form: f });
          }
        }
      }
    }).catch(() => {});
  }, []);

  const handleTogglePublished = async (f: FormDef) => {
    const nextPublished = !f.published;
    dispatch({ type: 'form/toggle', id: f.id });
    try {
      await api.forms.publish(f.id, nextPublished);
    } catch {
      await api.crm.update('forms', f.id, {
        published: nextPublished,
        status: nextPublished ? 'published' : 'draft',
      }).catch(() => {});
    }
  };

  const rows = state.forms.filter((f) => tab === 'all' || f.kind === tab);
  const submissions = state.forms.reduce((s, f) => s + f.submissions, 0);
  const published = state.forms.filter((f) => f.published).length;
  const editing = state.forms.find((f) => f.id === editingId) ?? null;
  const viewingForm = state.forms.find((f) => f.id === viewingSubmissionsId) ?? null;
  const embedForm = state.forms[0];

  return (
    <div className="content">
      <PageHeader
        title="Forms & Surveys"
        subtitle="Capture leads with forms and collect feedback with surveys."
        actions={
          <button className="btn btn--primary" onClick={() => setCreating(true)}>
            <Icon name="plus" size={16} /> New {tab === 'survey' ? 'survey' : 'form'}
          </button>
        }
      />

      <div className="grid grid--4" style={{ marginBottom: 16 }}>
        <StatCard label="Live forms" value={`${published}/${state.forms.length}`} icon={<Icon name="clipboard" size={15} />} meta="published" />
        <StatCard label="Submissions" value={num(submissions)} icon={<Icon name="send" size={15} />} meta="all time" />
        <StatCard
          label="Avg per form"
          value={num(Math.round(submissions / Math.max(state.forms.length, 1)))}
          icon={<Icon name="chart" size={15} />}
          meta="submissions"
        />
        <StatCard
          label="Completion"
          value={pct(state.forms.filter((f) => f.submissions > 0).length, state.forms.length || 1)}
          icon={<Icon name="check" size={15} />}
          meta="forms with data"
        />
      </div>

      <div className="card">
        <div className="card__head">
          <div className="tabs" style={{ borderBottom: 'none', padding: 0 }}>
            {TABS.map((t) => (
              <button key={t.value} className={`tab${tab === t.value ? ' is-active' : ''}`} onClick={() => setTab(t.value)}>
                {t.label}
              </button>
            ))}
          </div>
          <div className="card__actions">
            <span className="hint">{rows.length} items</span>
          </div>
        </div>

        <div className="table-wrap" style={{ borderTop: '1px solid var(--line)' }}>
          <table className="table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Type</th>
                <th>Fields</th>
                <th className="cell-right">Submissions</th>
                <th>Status</th>
                <th style={{ width: 60 }}>Live</th>
                <th style={{ width: 80 }} />
              </tr>
            </thead>
            <tbody>
              {rows.map((f) => (
                <tr key={f.id}>
                  <td>
                    <div className="row" style={{ gap: 9 }}>
                      <span
                        className="avatar avatar--sm"
                        style={{
                          background: f.kind === 'survey' ? 'var(--violet-soft)' : 'var(--accent-soft)',
                          color: f.kind === 'survey' ? 'var(--violet)' : 'var(--accent)',
                          borderRadius: 7,
                        }}
                      >
                        <Icon name={f.kind === 'survey' ? 'survey' : 'clipboard'} size={14} />
                      </span>
                      <span className="cell-main">{f.name}</span>
                    </div>
                  </td>
                  <td>
                    <Badge tone={f.kind === 'survey' ? 'violet' : 'blue'}>{f.kind}</Badge>
                  </td>
                  <td className="cell-sub">{f.fields.length} fields</td>
                  <td className="cell-right cell-num">{num(f.submissions)}</td>
                  <td>
                    <StatusBadge status={f.published ? 'published' : 'draft'} />
                  </td>
                  <td>
                    <Switch on={f.published} label={`Toggle ${f.name}`} onChange={() => handleTogglePublished(f)} />
                  </td>
                  <td className="cell-right">
                    <span className="row" style={{ gap: 4, justifyContent: 'flex-end' }}>
                      <a
                        className="icon-btn"
                        href={`/f/${f.slug || f.id}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        title={`Open Public Form: /f/${f.slug || f.id}`}
                      >
                        <Icon name="share" size={15} />
                      </a>
                      <button
                        className="icon-btn"
                        aria-label={`View Submissions for ${f.name}`}
                        title={`View Submissions (${f.submissions})`}
                        onClick={() => setViewingSubmissionsId(f.id)}
                      >
                        <Icon name="clipboard" size={15} />
                      </button>
                      <button className="icon-btn" aria-label={`Edit ${f.name}`} title="Edit Form" onClick={() => setEditingId(f.id)}>
                        <Icon name="edit" size={15} />
                      </button>
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="grid grid--2" style={{ marginTop: 16 }}>
        <div className="card">
          <div className="card__head">
            <div className="card__title">Top performer</div>
          </div>
          <div className="card__body">
            {(() => {
              const best = [...state.forms].sort((a, b) => b.submissions - a.submissions)[0];
              if (!best) return <span className="hint">No data yet</span>;
              return (
                <div className="stack" style={{ gap: 10 }}>
                  <div className="row" style={{ gap: 10 }}>
                    <span className="avatar avatar--md" style={{ background: 'var(--green-soft)', color: 'var(--green)' }}>
                      <Icon name="sparkles" size={17} />
                    </span>
                    <div>
                      <div style={{ fontSize: 13.5, fontWeight: 650 }}>{best.name}</div>
                      <div className="cell-sub">
                        {num(best.submissions)} submissions · {best.fields.length} fields
                      </div>
                    </div>
                  </div>
                  <div className="hint">
                    This {best.kind} accounts for{' '}
                    {pct(best.submissions, state.forms.reduce((s, f) => s + f.submissions, 0) || 1)} of all captured leads.
                  </div>
                </div>
              );
            })()}
          </div>
        </div>

        <div className="card">
          <div className="card__head">
            <div className="card__title">Embed snippet</div>
          </div>
          <div className="card__body stack">
            <div className="note" style={{ fontFamily: 'var(--font-mono)', fontSize: 12 }}>
              &lt;iframe src=&quot;https://forms.agency.test/embed/{slugify(embedForm?.name ?? 'contact-us')}&quot; /&gt;
            </div>
            <span className="hint">
              Paste this into any site builder to capture leads into this workspace. The slug follows the first
              form in the list.
            </span>
          </div>
        </div>
      </div>

      {creating && (
        <NewFormModal
          defaultKind={tab === 'survey' ? 'survey' : 'form'}
          onClose={() => setCreating(false)}
          onCreate={async (name, kind) => {
            const id = uid('fm');
            const slug = slugify(name);
            const newForm: FormDef = {
              id,
              name,
              slug,
              kind,
              published: false,
              submissions: 0,
              fields: [
                { id: uid('ff'), label: 'Full name', type: 'text', required: true, options: [] },
                { id: uid('ff'), label: 'Email', type: 'email', required: true, options: [] },
              ],
            };
            try {
              await api.crm.create('forms', {
                ...newForm,
                publicSlug: slug,
                status: 'draft',
              });
            } catch { /* dev fallback */ }
            dispatch({
              type: 'form/add',
              form: newForm,
            });
            setCreating(false);
            setEditingId(id);
          }}
        />
      )}

      {editing && <FormEditor form={editing} onClose={() => setEditingId(null)} />}

      {viewingForm && (
        <FormSubmissionsModal form={viewingForm} onClose={() => setViewingSubmissionsId(null)} />
      )}
    </div>
  );
}

function NewFormModal({
  defaultKind,
  onClose,
  onCreate,
}: {
  defaultKind: FormKind;
  onClose: () => void;
  onCreate: (name: string, kind: FormKind) => void;
}) {
  const [name, setName] = useState('');
  const [kind, setKind] = useState<FormKind>(defaultKind);

  return (
    <Modal
      title="New form"
      onClose={onClose}
      footer={
        <>
          <button className="btn" type="button" onClick={onClose}>
            Cancel
          </button>
          <button
            className="btn btn--primary"
            type="button"
            disabled={name.trim().length < 2}
            onClick={() => onCreate(name.trim(), kind)}
          >
            Create form
          </button>
        </>
      }
    >
      <div className="field">
        <label htmlFor="new-form-name">Name</label>
        <input
          id="new-form-name"
          className="input"
          autoFocus
          placeholder="Discovery call request"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </div>
      <div className="field" style={{ marginTop: 12 }}>
        <label>Type</label>
        <div className="segmented">
          {(['form', 'survey'] as const).map((value) => (
            <button
              key={value}
              type="button"
              className={kind === value ? 'is-active' : ''}
              onClick={() => setKind(value)}
              style={{ textTransform: 'capitalize' }}
            >
              {value}
            </button>
          ))}
        </div>
        <div className="hint" style={{ marginTop: 6 }}>
          New {kind === 'survey' ? 'surveys' : 'forms'} start unpublished with name and email fields you can edit
          right away.
        </div>
      </div>
    </Modal>
  );
}

function FormEditor({ form, onClose }: { form: FormDef; onClose: () => void }) {
  const { dispatch } = useStore();
  const [name, setName] = useState(form.name);
  const [fieldId, setFieldId] = useState<string | null>(null);
  const [label, setLabel] = useState('');
  const [type, setType] = useState<FormFieldType>('text');
  const [required, setRequired] = useState(false);
  const [options, setOptions] = useState('');
  const [points, setPoints] = useState<Record<string, number>>({});
  const [conditionFieldId, setConditionFieldId] = useState('');
  const [conditionValue, setConditionValue] = useState('');
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [submitted, setSubmitted] = useState(false);
  const [showScore, setShowScore] = useState(form.completion?.showScore ?? form.kind === 'survey');
  const [passing, setPassing] = useState(
    form.completion?.passingScore !== undefined ? String(form.completion.passingScore) : '',
  );
  const [redirect, setRedirect] = useState(form.completion?.redirectUrl ?? '');

  const choices = parseOptions(options);
  const redirectClean = redirect.trim();
  const redirectValid = redirectClean === '' || /^https?:\/\/\S+$/.test(redirectClean);
  const canSaveField =
    label.trim().length > 1 &&
    (type !== 'select' || choices.length >= 2) &&
    (conditionFieldId === '' || conditionValue !== '');
  const canRename = name.trim().length > 1 && name.trim() !== form.name;

  const conditionFields = form.fields.filter(
    (field) => field.type === 'select' && field.options.length > 0 && field.id !== fieldId,
  );
  const conditionSource = conditionFields.find((field) => field.id === conditionFieldId);

  const visibleFields = form.fields.filter(
    (field) => !field.showIf || answers[field.showIf.fieldId] === field.showIf.equals,
  );
  const conditionalCount = form.fields.filter((field) => field.showIf).length;
  const score = visibleFields.reduce(
    (sum, field) => sum + (field.points?.[answers[field.id] ?? ''] ?? 0),
    0,
  );
  const maxScore = visibleFields.reduce(
    (sum, field) => sum + Math.max(0, ...Object.values(field.points ?? {})),
    0,
  );
  const missingRequired = visibleFields.filter((field) => field.required && !answers[field.id]).length;
  const passingScore = passing.trim() === '' ? undefined : Number(passing);
  const passed = passingScore === undefined || score >= passingScore;

  const saveCompletion = () => {
    if (!redirectValid) return;
    const completion: FormCompletion = {
      showScore,
      redirectUrl: redirectClean || undefined,
      passingScore: passingScore !== undefined && Number.isFinite(passingScore) ? passingScore : undefined,
    };
    dispatch({ type: 'form/update', id: form.id, patch: { completion } });
    api.crm.update('forms', form.id, { completion }).catch(() => {});
  };

  const resetFieldForm = () => {
    setFieldId(null);
    setLabel('');
    setType('text');
    setRequired(false);
    setOptions('');
    setPoints({});
    setConditionFieldId('');
    setConditionValue('');
  };

  const startEdit = (field: FormField) => {
    setFieldId(field.id);
    setLabel(field.label);
    setType(field.type);
    setRequired(field.required);
    setOptions(field.options.join(', '));
    setPoints(field.points ?? {});
    setConditionFieldId(field.showIf?.fieldId ?? '');
    setConditionValue(field.showIf?.equals ?? '');
  };

  const saveField = () => {
    if (!canSaveField) return;
    const fieldPoints =
      form.kind === 'survey' && type === 'select' && choices.length > 0
        ? Object.fromEntries(choices.map((option) => [option, points[option] ?? 0]))
        : undefined;
    const patch: Partial<FormField> = {
      label: label.trim(),
      type,
      required,
      options: type === 'select' ? choices : [],
      points: fieldPoints,
      showIf:
        conditionFieldId && conditionValue
          ? { fieldId: conditionFieldId, equals: conditionValue }
          : undefined,
    };
    if (fieldId) {
      dispatch({ type: 'form/field/update', formId: form.id, id: fieldId, patch });
      const updatedFields = form.fields.map((f) => (f.id === fieldId ? { ...f, ...patch } : f));
      api.crm.update('forms', form.id, { fields: updatedFields }).catch(() => {});
    } else {
      const newField: FormField = {
        id: uid('ff'),
        label: patch.label ?? '',
        type,
        required,
        options: patch.options ?? [],
        points: patch.points,
        showIf: patch.showIf,
      };
      dispatch({
        type: 'form/field/add',
        formId: form.id,
        field: newField,
      });
      api.crm.update('forms', form.id, { fields: [...form.fields, newField] }).catch(() => {});
    }
    resetFieldForm();
  };

  return (
    <Modal
      title={`Edit ${form.kind === 'survey' ? 'survey' : 'form'}`}
      wide
      onClose={onClose}
      footer={
        <button className="btn" type="button" onClick={onClose}>
          Done
        </button>
      }
    >
      <div className="grid grid--2" style={{ alignItems: 'start' }}>
        <div>
          <div className="field">
            <label htmlFor="form-name">Form name</label>
            <div className="row" style={{ gap: 8 }}>
              <input
                id="form-name"
                className="input"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
              <button
                className="btn btn--sm"
                type="button"
                disabled={!canRename}
                onClick={() => {
                  const newName = name.trim();
                  dispatch({ type: 'form/update', id: form.id, patch: { name: newName } });
                  api.crm.update('forms', form.id, { name: newName }).catch(() => {});
                }}
              >
                Rename
              </button>
            </div>
          </div>

          <div className="row row--between" style={{ marginTop: 16, marginBottom: 8 }}>
            <strong style={{ fontSize: 13 }}>Fields</strong>
            <span className="cell-sub">{form.fields.length} total</span>
          </div>

          <div className="stack" style={{ gap: 8 }}>
            {form.fields.length === 0 && (
              <div className="hint">No fields yet. Add the first one below — the preview updates as you go.</div>
            )}
            {form.fields.map((field, index) => (
              <div className="field-row" key={field.id}>
                <span className="avatar avatar--sm avatar--square" style={{ background: 'var(--surface-3)', color: 'var(--text-2)' }}>
                  <Icon name={iconFor(field.type)} size={13} />
                </span>
                <div className="field-row__body">
                  <div className="field-row__label">{field.label || 'Untitled field'}</div>
                  <div className="field-row__meta">
                    <Badge tone="blue">{labelFor(field.type)}</Badge>
                    {field.required && <Badge tone="amber">Required</Badge>}
                    {field.showIf && <Badge tone="violet">Conditional</Badge>}
                    {field.points && Object.values(field.points).some((value) => value > 0) && (
                      <Badge tone="violet">Scored</Badge>
                    )}
                    {field.type === 'select' && field.options.length > 0 && (
                      <span className="cell-sub">{field.options.join(' · ')}</span>
                    )}
                  </div>
                </div>
                <div className="field-row__tools">
                  <button
                    className="icon-btn"
                    aria-label={`Move ${field.label} up`}
                    disabled={index === 0}
                    onClick={() =>
                      dispatch({ type: 'form/field/move', formId: form.id, id: field.id, direction: 'up' })
                    }
                  >
                    <Icon name="chevron-up" size={13} />
                  </button>
                  <button
                    className="icon-btn"
                    aria-label={`Move ${field.label} down`}
                    disabled={index === form.fields.length - 1}
                    onClick={() =>
                      dispatch({ type: 'form/field/move', formId: form.id, id: field.id, direction: 'down' })
                    }
                  >
                    <Icon name="chevron-down" size={13} />
                  </button>
                  <button className="icon-btn" aria-label={`Edit ${field.label}`} onClick={() => startEdit(field)}>
                    <Icon name="edit" size={13} />
                  </button>
                  <button
                    className="icon-btn"
                    aria-label={`Delete ${field.label}`}
                    onClick={() => {
                      dispatch({ type: 'form/field/delete', formId: form.id, id: field.id });
                      api.crm.update('forms', form.id, { fields: form.fields.filter((f) => f.id !== field.id) }).catch(() => {});
                    }}
                  >
                    <Icon name="trash" size={13} />
                  </button>
                </div>
              </div>
            ))}
          </div>

          <div className="builder-box" style={{ marginTop: 12 }}>
            <div className="row row--between">
              <strong style={{ fontSize: 13 }}>{fieldId ? 'Edit field' : 'Add a field'}</strong>
              {fieldId && (
                <button className="btn btn--sm" type="button" onClick={resetFieldForm}>
                  Cancel edit
                </button>
              )}
            </div>
            <div className="grid grid--2" style={{ marginTop: 10 }}>
              <div className="field">
                <label htmlFor="field-label">Label</label>
                <input
                  id="field-label"
                  className="input"
                  placeholder="Company size"
                  value={label}
                  onChange={(e) => setLabel(e.target.value)}
                />
              </div>
              <div className="field">
                <label htmlFor="field-type">Type</label>
                <select
                  id="field-type"
                  className="select"
                  value={type}
                  onChange={(e) => setType(e.target.value as FormFieldType)}
                >
                  {FIELD_TYPES.map((t) => (
                    <option key={t.value} value={t.value}>
                      {t.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            {type === 'select' && (
              <div className="field" style={{ marginTop: 10 }}>
                <label htmlFor="field-options">Choices (comma separated, two or more)</label>
                <input
                  id="field-options"
                  className="input"
                  placeholder="1–10, 11–50, 51+"
                  value={options}
                  onChange={(e) => setOptions(e.target.value)}
                />
                {choices.length < 2 && <div className="hint">Add at least two choices to save this dropdown.</div>}
              </div>
            )}
            {form.kind === 'survey' && type === 'select' && choices.length > 0 && (
              <div className="field" style={{ marginTop: 10 }}>
                <label>Answer points</label>
                <div className="grid grid--2" style={{ gap: 8 }}>
                  {choices.map((option) => (
                    <label key={option} className="row" style={{ gap: 8 }}>
                      <span className="cell-sub" style={{ flex: 1, minWidth: 0 }}>
                        {option}
                      </span>
                      <input
                        className="input"
                        type="number"
                        min={0}
                        aria-label={`Points for ${option}`}
                        style={{ width: 72 }}
                        value={points[option] ?? 0}
                        onChange={(e) =>
                          setPoints((current) => ({ ...current, [option]: Number(e.target.value) }))
                        }
                      />
                    </label>
                  ))}
                </div>
                <div className="hint">Points feed the live score shown in the preview.</div>
              </div>
            )}
            <div className="grid grid--2" style={{ marginTop: 10 }}>
              <div className="field">
                <label htmlFor="field-condition">Show only when</label>
                <select
                  id="field-condition"
                  className="select"
                  value={conditionFieldId}
                  onChange={(e) => {
                    setConditionFieldId(e.target.value);
                    setConditionValue('');
                  }}
                >
                  <option value="">Always visible</option>
                  {conditionFields.map((field) => (
                    <option key={field.id} value={field.id}>
                      {field.label}
                    </option>
                  ))}
                </select>
              </div>
              {conditionFieldId && (
                <div className="field">
                  <label htmlFor="field-condition-value">Answer equals</label>
                  <select
                    id="field-condition-value"
                    className="select"
                    value={conditionValue}
                    onChange={(e) => setConditionValue(e.target.value)}
                  >
                    <option value="">Choose a value</option>
                    {(conditionSource?.options ?? []).map((option) => (
                      <option key={option} value={option}>
                        {option}
                      </option>
                    ))}
                  </select>
                </div>
              )}
            </div>
            <div className="row row--between" style={{ marginTop: 10 }}>
              <div className="row" style={{ gap: 8 }}>
                <Switch on={required} label="Field required" onChange={() => setRequired((v) => !v)} />
                <span className="hint">Required</span>
              </div>
              <button className="btn btn--sm btn--primary" type="button" disabled={!canSaveField} onClick={saveField}>
                {fieldId ? 'Save field' : 'Add field'}
              </button>
            </div>
          </div>

          <div className="builder-box" style={{ marginTop: 12 }}>
            <div className="row row--between">
              <strong style={{ fontSize: 13 }}>Completion &amp; scoring</strong>
              <Switch on={showScore} label="Show score" onChange={() => setShowScore((v) => !v)} />
            </div>
            <div className="grid grid--2" style={{ marginTop: 10 }}>
              <div className="field">
                <label htmlFor="form-passing">Passing score</label>
                <input
                  id="form-passing"
                  className="input"
                  type="number"
                  min={0}
                  placeholder="Optional"
                  value={passing}
                  onChange={(e) => setPassing(e.target.value)}
                />
              </div>
              <div className="field">
                <label htmlFor="form-redirect">Redirect after submit</label>
                <input
                  id="form-redirect"
                  className="input"
                  placeholder="https://example.com/thanks"
                  value={redirect}
                  onChange={(e) => setRedirect(e.target.value)}
                />
              </div>
            </div>
            {!redirectValid && (
              <div className="callout callout--danger">Redirect must start with http:// or https://.</div>
            )}
            <div className="row row--between" style={{ marginTop: 10 }}>
              <span className="hint" style={{ minWidth: 0 }}>
                {form.completion?.redirectUrl
                  ? `Currently redirects to ${form.completion.redirectUrl}`
                  : 'No redirect configured.'}
              </span>
              <button
                className="btn btn--sm"
                type="button"
                disabled={!redirectValid || (passingScore !== undefined && !Number.isFinite(passingScore))}
                onClick={saveCompletion}
              >
                Save completion
              </button>
            </div>
          </div>
        </div>

        <div className="builder-box">
          <div className="row row--between" style={{ marginBottom: 10 }}>
            <strong style={{ fontSize: 13 }}>Live preview</strong>
            <Badge tone={form.published ? 'green' : 'default'} dot>
              {form.published ? 'Published' : 'Draft'}
            </Badge>
          </div>
          <div className="form-preview">
            <div className="row row--between" style={{ marginBottom: 12 }}>
              <div className="form-preview__title" style={{ marginBottom: 0 }}>
                {name.trim() || form.name}
              </div>
              {showScore && (
                <Badge tone="violet">
                  Score {score}/{maxScore}
                </Badge>
              )}
            </div>
            {submitted ? (
              <div className="form-preview__done">
                <span className="form-preview__done-icon">
                  <Icon name="check" size={20} />
                </span>
                <strong style={{ fontSize: 13 }}>Response recorded</strong>
                {showScore && (
                  <div className="hint">
                    Score {score} of {maxScore}
                    {passingScore === undefined
                      ? ' · no pass mark set'
                      : passed
                        ? ' · passed'
                        : ' · below the pass mark'}
                  </div>
                )}
                {redirectClean && <div className="hint">Simulated redirect to {redirectClean}</div>}
                <button
                  className="btn btn--sm"
                  type="button"
                  onClick={() => {
                    setSubmitted(false);
                    setAnswers({});
                  }}
                >
                  Submit another response
                </button>
              </div>
            ) : (
              <>
            {form.fields.length === 0 && <div className="hint">Add a field to see it here.</div>}
            {visibleFields.map((field) => (
              <div className="form-preview__field" key={field.id}>
                {field.type === 'consent' ? (
                  <label className="checkbox">
                    <input
                      type="checkbox"
                      checked={answers[field.id] === 'yes'}
                      onChange={(e) =>
                        setAnswers((current) => ({ ...current, [field.id]: e.target.checked ? 'yes' : '' }))
                      }
                    />
                    <span>
                      {field.label}
                      {field.required && <span className="form-preview__req">*</span>}
                    </span>
                  </label>
                ) : (
                  <>
                    <label>
                      {field.label}
                      {field.required && <span className="form-preview__req">*</span>}
                    </label>
                    {field.type === 'textarea' ? (
                      <textarea
                        className="input"
                        rows={3}
                        placeholder="Type your answer…"
                        value={answers[field.id] ?? ''}
                        onChange={(e) => setAnswers((current) => ({ ...current, [field.id]: e.target.value }))}
                      />
                    ) : field.type === 'select' ? (
                      <select
                        className="select"
                        value={answers[field.id] ?? ''}
                        onChange={(e) => setAnswers((current) => ({ ...current, [field.id]: e.target.value }))}
                      >
                        <option value="" disabled>
                          Select…
                        </option>
                        {field.options.map((option) => (
                          <option key={option}>{option}</option>
                        ))}
                      </select>
                    ) : (
                      <input
                        className="input"
                        type={field.type === 'email' ? 'email' : field.type === 'phone' ? 'tel' : 'text'}
                        placeholder={field.type === 'email' ? 'name@example.com' : field.type === 'phone' ? '+1 555 000 0000' : 'Type your answer…'}
                        value={answers[field.id] ?? ''}
                        onChange={(e) => setAnswers((current) => ({ ...current, [field.id]: e.target.value }))}
                      />
                    )}
                  </>
                )}
              </div>
            ))}
            <button
              className="btn btn--primary btn--sm"
              type="button"
              disabled={visibleFields.length === 0 || missingRequired > 0}
              onClick={() => setSubmitted(true)}
            >
              Submit
            </button>
            {missingRequired > 0 && (
              <div className="hint" style={{ marginTop: 6 }}>
                {missingRequired} required field{missingRequired === 1 ? '' : 's'} left.
              </div>
            )}
              </>
            )}
          </div>
          {conditionalCount > 0 && (
            <div className="hint" style={{ marginTop: 8 }}>
              {visibleFields.length} of {form.fields.length} fields visible — answer the dropdowns to see
              branches appear.
            </div>
          )}
          <div className="hint" style={{ marginTop: 8 }}>
            Preview only — submissions are simulated and stored locally.
          </div>
        </div>
      </div>
    </Modal>
  );
}

function FormSubmissionsModal({
  form,
  onClose,
}: {
  form: FormDef;
  onClose: () => void;
}) {
  const [submissions, setSubmissions] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.forms.getSubmissions(form.id)
      .then((res) => {
        setSubmissions(res.submissions || []);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [form.id]);

  return (
    <Modal
      title={`${form.name} — Submissions (${submissions.length})`}
      wide
      onClose={onClose}
      footer={
        <button className="btn" type="button" onClick={onClose}>
          Close
        </button>
      }
    >
      {loading ? (
        <div style={{ padding: 24, textAlign: 'center' }}>Loading form responses...</div>
      ) : submissions.length === 0 ? (
        <div className="card__body" style={{ textAlign: 'center', padding: '32px 16px' }}>
          <span className="avatar avatar--lg" style={{ background: 'var(--surface-3)', margin: '0 auto 12px' }}>
            <Icon name="clipboard" size={24} />
          </span>
          <div style={{ fontWeight: 650, fontSize: 15, marginBottom: 4 }}>No Submissions Yet</div>
          <div className="hint" style={{ maxWidth: 440, margin: '0 auto 16px' }}>
            When visitors submit this {form.kind}, their answers and contact details will be captured here in real-time.
          </div>
          <a
            className="btn btn--sm"
            href={`/f/${form.slug || form.id}`}
            target="_blank"
            rel="noopener noreferrer"
          >
            <Icon name="share" size={13} /> View Public Form Link
          </a>
        </div>
      ) : (
        <div className="stack" style={{ gap: 12 }}>
          {submissions.map((s, idx) => (
            <div key={s.id || idx} className="card" style={{ padding: 14 }}>
              <div className="row row--between" style={{ marginBottom: 10 }}>
                <div className="row" style={{ gap: 8 }}>
                  <span className="avatar avatar--sm" style={{ background: 'var(--accent-soft)', color: 'var(--accent)' }}>
                    <Icon name="user" size={13} />
                  </span>
                  <div>
                    <strong style={{ fontSize: 13.5 }}>{s.contactName || 'Anonymous Respondent'}</strong>
                    <div className="cell-sub">{s.email || 'No email provided'} {s.phone ? `· ${s.phone}` : ''}</div>
                  </div>
                </div>
                <div className="row" style={{ gap: 8 }}>
                  <span className="hint" style={{ fontSize: 12 }}>
                    {shortDate(s.submittedAt || s.createdAt || new Date().toISOString())}
                  </span>
                  <Badge tone="blue">{s.source || 'web'}</Badge>
                </div>
              </div>
              <div
                style={{
                  background: 'var(--surface-2)',
                  borderRadius: 6,
                  padding: '8px 12px',
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
                  gap: 8,
                  fontSize: 12.5,
                }}
              >
                {Object.entries(s.answers || {}).map(([key, val]) => (
                  <div key={key}>
                    <span className="cell-sub" style={{ textTransform: 'capitalize', display: 'block', fontSize: 11 }}>
                      {key.replace(/([A-Z])/g, ' $1')}
                    </span>
                    <span style={{ fontWeight: 550 }}>{String(val)}</span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </Modal>
  );
}
