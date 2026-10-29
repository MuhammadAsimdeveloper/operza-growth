import { useMemo, useState } from 'react';
import { Icon } from '../components/Icon';
import { Modal } from '../components/Modal';
import { Badge, EmptyState, PageHeader } from '../components/ui';
import { useStore, uid } from '../lib/store';
import { customValueToken, resolveMerge } from '../lib/merge';
import { num, relative } from '../lib/format';
import type { EmailTemplate } from '../lib/types';

const TOKENS = [
  '{{contact.first_name}}',
  '{{contact.last_name}}',
  '{{contact.full_name}}',
  '{{contact.company}}',
  '{{contact.email}}',
];

export default function Templates() {
  const { state, dispatch } = useStore();
  const { templates, contacts, customValues } = state;
  const [category, setCategory] = useState('All');
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [editing, setEditing] = useState<EmailTemplate | 'new' | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  const categories = useMemo(
    () => ['All', ...Array.from(new Set(templates.map((t) => t.category)))],
    [templates],
  );
  const visible = templates.filter((t) => category === 'All' || t.category === category);
  const preview = previewId ? templates.find((t) => t.id === previewId) : undefined;
  const sampleContact = contacts[0];

  async function applyTemplate(t: EmailTemplate) {
    const subject = resolveMerge(t.subject, sampleContact, customValues);
    try {
      await navigator.clipboard.writeText(subject);
    } catch {
      /* clipboard unavailable — the increment still records the use */
    }
    dispatch({ type: 'template/use', id: t.id });
    setCopied(t.id);
    window.setTimeout(() => setCopied((cur) => (cur === t.id ? null : cur)), 1600);
  }

  return (
    <div className="content">
      <PageHeader
        title="Email Templates"
        subtitle="Reusable copy for campaigns, workflows and one-off sends."
        actions={
          <button className="btn btn--primary" onClick={() => setEditing('new')}>
            <Icon name="plus" size={16} /> New template
          </button>
        }
      />

      <div className="row" style={{ gap: 6, flexWrap: 'wrap', marginBottom: 16 }}>
        {categories.map((c) => (
          <button
            key={c}
            type="button"
            className={`chip${category === c ? ' is-active' : ''}`}
            onClick={() => setCategory(c)}
          >
            {c}
          </button>
        ))}
      </div>

      {visible.length === 0 ? (
        <EmptyState icon={<Icon name="mail" size={22} />} title="No templates" text="Try another category." />
      ) : (
        <div className="grid grid--3">
          {visible.map((t) => (
            <div key={t.id} className="card template">
              <div className="card__head">
                <div style={{ minWidth: 0 }}>
                  <div className="card__title" style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {t.name}
                  </div>
                  <div className="card__sub">{t.category}</div>
                </div>
                <div className="card__actions">
                  <Badge>{num(t.uses)} uses</Badge>
                </div>
              </div>
              <div className="card__body stack" style={{ gap: 10 }}>
                <div className="template__subject">{t.subject}</div>
                <div className="cell-sub">Updated {relative(t.updatedAt)}</div>
                <div className="row" style={{ gap: 8, marginTop: 2 }}>
                  <button type="button" className="btn btn--sm btn--primary" onClick={() => applyTemplate(t)}>
                    <Icon name={copied === t.id ? 'check' : 'copy'} size={13} />
                    {copied === t.id ? 'Copied' : 'Copy subject'}
                  </button>
                  <button type="button" className="btn btn--sm" aria-label={`Edit ${t.name}`} onClick={() => setEditing(t)}>
                    <Icon name="edit" size={13} /> Edit
                  </button>
                  <button type="button" className="btn btn--sm" onClick={() => setPreviewId(t.id)}>
                    <Icon name="eye" size={13} /> Preview
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {preview && (
        <Modal
          title={preview.name}
          wide
          onClose={() => setPreviewId(null)}
          footer={
            <>
              <button className="btn" type="button" onClick={() => setPreviewId(null)}>
                Close
              </button>
              <button
                className="btn btn--primary"
                type="button"
                onClick={() => {
                  applyTemplate(preview);
                  setPreviewId(null);
                }}
              >
                <Icon name="copy" size={14} /> Copy subject
              </button>
            </>
          }
        >
          <div className="field">
            <label>Subject</label>
            <div className="template__subject">
              {resolveMerge(preview.subject, sampleContact, customValues)}
            </div>
          </div>
          <div className="field" style={{ marginTop: 12 }}>
            <label>Body</label>
            <div className="template__preview" style={{ whiteSpace: 'pre-wrap', fontSize: 13, lineHeight: 1.65 }}>
              {resolveMerge(preview.body, sampleContact, customValues)}
            </div>
          </div>
          <div className="row" style={{ gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
            <Badge tone="blue">{preview.category}</Badge>
            <Badge>{num(preview.uses)} uses</Badge>
            <Badge>Updated {relative(preview.updatedAt)}</Badge>
            {sampleContact && <span className="hint">Tokens previewed with {sampleContact.firstName} {sampleContact.lastName}.</span>}
          </div>
        </Modal>
      )}

      {editing && (
        <TemplateEditor
          template={editing === 'new' ? undefined : editing}
          categories={categories.filter((c) => c !== 'All')}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}

function TemplateEditor({
  template,
  categories,
  onClose,
}: {
  template?: EmailTemplate;
  categories: string[];
  onClose: () => void;
}) {
  const { state, dispatch } = useStore();
  const [name, setName] = useState(template?.name ?? '');
  const [category, setCategory] = useState(template?.category ?? 'Marketing');
  const [subject, setSubject] = useState(template?.subject ?? '');
  const [body, setBody] = useState(template?.body ?? '');

  const sampleContact = state.contacts[0];
  const canSave = name.trim().length > 1 && subject.trim().length > 1;

  const insertToken = (token: string) => {
    setBody((current) => (current.trim() ? `${current.replace(/\s+$/, '')} ${token}` : token));
  };

  const save = () => {
    if (!canSave) return;
    const cleanCategory = category.trim() || 'General';
    if (template) {
      dispatch({
        type: 'template/update',
        id: template.id,
        patch: { name: name.trim(), category: cleanCategory, subject: subject.trim(), body },
      });
    } else {
      dispatch({
        type: 'template/add',
        template: {
          id: uid('tp'),
          name: name.trim(),
          category: cleanCategory,
          subject: subject.trim(),
          body,
          updatedAt: new Date().toISOString(),
          uses: 0,
        },
      });
    }
    onClose();
  };

  return (
    <Modal
      title={template ? `Edit template · ${template.name}` : 'New template'}
      wide
      onClose={onClose}
      footer={
        <>
          {template && (
            <button
              className="btn"
              type="button"
              style={{ marginRight: 'auto', color: 'var(--red)' }}
              onClick={() => {
                dispatch({ type: 'template/delete', id: template.id });
                onClose();
              }}
            >
              <Icon name="trash" size={14} /> Delete
            </button>
          )}
          <button className="btn" type="button" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn--primary" type="button" disabled={!canSave} onClick={save}>
            {template ? 'Save template' : 'Create template'}
          </button>
        </>
      }
    >
      <div className="grid grid--2" style={{ alignItems: 'start' }}>
        <div className="stack" style={{ gap: 12 }}>
          <div className="grid grid--2">
            <div className="field">
              <label htmlFor="template-name">Template name</label>
              <input id="template-name" className="input" value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div className="field">
              <label htmlFor="template-category">Category</label>
              <input
                id="template-category"
                className="input"
                list="template-categories"
                value={category}
                onChange={(e) => setCategory(e.target.value)}
              />
              <datalist id="template-categories">
                {categories.map((c) => (
                  <option key={c} value={c} />
                ))}
              </datalist>
            </div>
          </div>
          <div className="field">
            <label htmlFor="template-subject">Subject</label>
            <input
              id="template-subject"
              className="input"
              placeholder="Welcome aboard — here is what happens next"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor="template-body">Body</label>
            <textarea
              id="template-body"
              className="input"
              rows={10}
              placeholder={'Hi {{contact.first_name}},\n\nWrite the message here…'}
              value={body}
              onChange={(e) => setBody(e.target.value)}
            />
          </div>
          <div className="field">
            <label>Insert token</label>
            <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
              {[...TOKENS, ...state.customValues.map((v) => customValueToken(v.name))].map((token) => (
                <button
                  key={token}
                  type="button"
                  className="chip"
                  style={{ fontFamily: 'var(--font-mono)', fontSize: 11 }}
                  onClick={() => insertToken(token)}
                >
                  {token}
                </button>
              ))}
            </div>
            <div className="hint" style={{ marginTop: 6 }}>
              Tokens resolve against the sample contact and custom values when the email is sent.
            </div>
          </div>
        </div>

        <div className="builder-box">
          <div className="row row--between" style={{ marginBottom: 10 }}>
            <strong style={{ fontSize: 13 }}>Live preview</strong>
            {sampleContact && (
              <span className="hint">
                {sampleContact.firstName} {sampleContact.lastName}
              </span>
            )}
          </div>
          <div className="template__preview" style={{ whiteSpace: 'pre-wrap', fontSize: 13, lineHeight: 1.65 }}>
            <div style={{ fontWeight: 650, marginBottom: 10 }}>
              {resolveMerge(subject, sampleContact, state.customValues) || 'Subject line appears here'}
            </div>
            {resolveMerge(body, sampleContact, state.customValues) || 'Start writing to see the email body.'}
          </div>
        </div>
      </div>
    </Modal>
  );
}
