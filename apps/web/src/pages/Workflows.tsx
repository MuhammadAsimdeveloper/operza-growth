import { useState, type ReactElement } from 'react';
import { Icon } from '../components/Icon';
import { Modal } from '../components/Modal';
import { Badge, EmptyState, PageHeader, StatCard, StatusBadge, Switch } from '../components/ui';
import { num, pct, relative } from '../lib/format';
import { uid, useStore } from '../lib/store';
import type {
  ConditionField,
  ConditionOperator,
  ConditionRule,
  Contact,
  Workflow,
  WorkflowAction,
  WorkflowRun,
  WorkflowRunStep,
  WorkflowStepConfig,
  WorkflowTrigger,
  WorkflowTriggerKind,
} from '../lib/types';

const ACTION_ICON: Record<WorkflowAction['kind'], string> = {
  sms: 'message',
  email: 'mail',
  wait: 'wait',
  tag: 'tag',
  task: 'task',
  webhook: 'webhook',
  condition: 'condition',
};

const KINDS: Array<{ value: WorkflowAction['kind']; label: string; defaultLabel: string }> = [
  { value: 'email', label: 'Send email', defaultLabel: 'Send email' },
  { value: 'sms', label: 'Send SMS', defaultLabel: 'Send SMS' },
  { value: 'wait', label: 'Wait', defaultLabel: 'Wait step' },
  { value: 'tag', label: 'Apply tag', defaultLabel: 'Apply tag' },
  { value: 'task', label: 'Create task', defaultLabel: 'Create follow-up task' },
  { value: 'webhook', label: 'Webhook', defaultLabel: 'POST to endpoint' },
  { value: 'condition', label: 'If / else', defaultLabel: 'Check contact status' },
];

const TRIGGER_KINDS: Array<{ value: WorkflowTriggerKind; label: string }> = [
  { value: 'form', label: 'Form submitted' },
  { value: 'tag', label: 'Tag added' },
  { value: 'appointment', label: 'Appointment booked' },
  { value: 'invoice', label: 'Invoice overdue' },
  { value: 'payment', label: 'Payment received' },
  { value: 'webhook', label: 'Inbound webhook' },
  { value: 'schedule', label: 'Schedule' },
];

const TRIGGER_ICON: Record<WorkflowTriggerKind, string> = {
  form: 'clipboard',
  tag: 'tag',
  appointment: 'calendar',
  invoice: 'dollar',
  payment: 'wallet',
  webhook: 'webhook',
  schedule: 'clock',
};

const TRIGGER_HINT: Record<WorkflowTriggerKind, string> = {
  form: 'Starts when a contact submits the chosen form.',
  tag: 'Starts when the tag is added to a contact.',
  appointment: 'Starts when an appointment is booked on any calendar.',
  invoice: 'Starts when an invoice becomes overdue.',
  payment: 'Starts when a payment is recorded.',
  webhook: 'Starts when an outside system posts to your workspace URL.',
  schedule: 'Starts on a repeating interval for every enrolled contact.',
};

const FIELD_LABELS: Record<ConditionField, string> = {
  tag: 'Contact tag',
  status: 'Contact status',
  company: 'Company',
  email: 'Email',
};

const OPERATOR_LABELS: Record<ConditionOperator, string> = {
  is: 'is',
  is_not: 'is not',
  contains: 'contains',
};

const STATUS_VALUES: Contact['status'][] = ['lead', 'customer', 'cold'];

function unitName(unit: WorkflowTrigger['unit']): string {
  const value = unit ?? 'days';
  return value === 'days' ? 'day' : value === 'hours' ? 'hour' : 'minute';
}

function triggerText(trigger: WorkflowTrigger): string {
  switch (trigger.kind) {
    case 'form':
      return `Form submitted · ${trigger.detail || 'any form'}`;
    case 'tag':
      return `Tag added · ${trigger.detail || 'any tag'}`;
    case 'webhook':
      return `Inbound webhook · /${(trigger.detail ?? '').replace(/^\/+/, '') || 'hook'}`;
    case 'schedule': {
      const every = trigger.every ?? 1;
      const unit = unitName(trigger.unit);
      return `Every ${every} ${every === 1 ? unit : `${unit}s`}`;
    }
    case 'appointment':
      return 'Appointment booked';
    case 'invoice':
      return 'Invoice overdue';
    case 'payment':
      return 'Payment received';
  }
}

function delayText(hours?: number): string {
  if (!hours) return 'No delay set';
  if (hours % 24 === 0) {
    const days = hours / 24;
    return `${days} day${days === 1 ? '' : 's'}`;
  }
  return `${hours} hour${hours === 1 ? '' : 's'}`;
}

function ruleText(rule?: ConditionRule): string {
  if (!rule) return 'No rule set';
  return `${FIELD_LABELS[rule.field]} ${OPERATOR_LABELS[rule.operator]} ${rule.value || '…'}`;
}

function stepMeta(step: WorkflowAction): string {
  switch (step.kind) {
    case 'wait':
      return `wait · ${delayText(step.delayHours)}`;
    case 'webhook':
      return `webhook · ${step.config?.url ? `${step.config.method ?? 'POST'} ${step.config.url}` : 'no endpoint'}`;
    case 'tag':
      return `tag · ${step.config?.tag ?? 'not set'}`;
    case 'task':
      return `task · due in ${step.config?.dueInDays ?? 0} day${(step.config?.dueInDays ?? 0) === 1 ? '' : 's'}`;
    case 'condition':
      return `if ${ruleText(step.config?.rule)}`;
    default:
      return step.kind;
  }
}

function countSteps(actions: WorkflowAction[]): number {
  return actions.reduce((total, step) => total + 1 + countSteps(step.yes ?? []) + countSteps(step.no ?? []), 0);
}

function ruleMatches(rule: ConditionRule, contact: Contact): boolean {
  const expected = rule.value.trim().toLowerCase();
  if (!expected) return false;

  if (rule.field === 'tag') {
    const tags = contact.tags.map((tag) => tag.toLowerCase());
    if (rule.operator === 'is') return tags.includes(expected);
    if (rule.operator === 'is_not') return !tags.includes(expected);
    return tags.some((tag) => tag.includes(expected));
  }

  const actual = (
    rule.field === 'status' ? contact.status : rule.field === 'company' ? contact.company : contact.email
  ).toLowerCase();
  if (rule.operator === 'is') return actual === expected;
  if (rule.operator === 'is_not') return actual !== expected;
  return actual.includes(expected);
}

function simulateRun(flow: Workflow, contact: Contact): WorkflowRun {
  const steps: WorkflowRunStep[] = [];
  let failed = false;

  const visit = (list: WorkflowAction[]) => {
    for (const step of list) {
      if (failed) {
        steps.push({ label: step.label, kind: step.kind, status: 'skipped' });
        continue;
      }

      if (step.kind === 'condition') {
        const rule = step.config?.rule;
        const pass = rule ? ruleMatches(rule, contact) : false;
        steps.push({
          label: step.label,
          kind: step.kind,
          status: 'done',
          detail: pass ? 'Yes branch' : 'No branch',
        });
        visit((pass ? step.yes : step.no) ?? []);
        continue;
      }

      if (step.kind === 'webhook') {
        const url = step.config?.url?.trim() ?? '';
        if (!/^https?:\/\/\S+$/i.test(url)) {
          steps.push({
            label: step.label,
            kind: step.kind,
            status: 'failed',
            detail: 'Invalid or missing webhook URL',
          });
          failed = true;
          continue;
        }
        steps.push({
          label: step.label,
          kind: step.kind,
          status: 'done',
          detail: `${step.config?.method ?? 'POST'} ${url} · simulated`,
        });
        continue;
      }

      if (step.kind === 'wait') {
        steps.push({
          label: step.label,
          kind: step.kind,
          status: 'done',
          detail: `${delayText(step.delayHours)} · simulated`,
        });
        continue;
      }

      if (step.kind === 'tag') {
        steps.push({
          label: step.label,
          kind: step.kind,
          status: 'done',
          detail: `Tag "${step.config?.tag ?? 'untitled'}" applied`,
        });
        continue;
      }

      if (step.kind === 'task') {
        const due = step.config?.dueInDays ?? 0;
        steps.push({
          label: step.label,
          kind: step.kind,
          status: 'done',
          detail: `Task created · due in ${due} day${due === 1 ? '' : 's'}`,
        });
        continue;
      }

      steps.push({
        label: step.label,
        kind: step.kind,
        status: 'done',
        detail: `${step.kind === 'sms' ? 'SMS' : 'Email'} queued · simulated`,
      });
    }
  };

  visit(flow.actions);
  const done = steps.filter((step) => step.status === 'done').length;

  return {
    id: uid('run'),
    workflowId: flow.id,
    contactId: contact.id,
    at: new Date().toISOString(),
    status: failed ? 'failed' : 'success',
    durationMs: 400 + done * 260,
    steps,
  };
}

export default function Workflows() {
  const { state, dispatch } = useStore();
  const [selectedId, setSelectedId] = useState(state.workflows[0]?.id ?? null);
  const [creating, setCreating] = useState(false);
  const [editingDetails, setEditingDetails] = useState<Workflow | null>(null);
  const [stepDraft, setStepDraft] = useState<{
    workflowId: string;
    step?: WorkflowAction;
    parentId?: string;
    branch?: 'yes' | 'no';
  } | null>(null);
  const [runFor, setRunFor] = useState<Workflow | null>(null);
  const [showTemplates, setShowTemplates] = useState(false);
  const [viewingRun, setViewingRun] = useState<WorkflowRun | null>(null);

  const selected = state.workflows.find((w) => w.id === selectedId) ?? null;
  const live = state.workflows.filter((w) => w.status === 'published');
  const enrolled = state.workflows.reduce((s, w) => s + w.enrolled, 0);
  const succeeded = state.workflowRuns.filter((run) => run.status === 'success').length;
  const runsFor = selected ? state.workflowRuns.filter((run) => run.workflowId === selected.id) : [];

  const contactName = (id: string) => {
    const contact = state.contacts.find((c) => c.id === id);
    return contact ? `${contact.firstName} ${contact.lastName}` : 'Unknown contact';
  };

  const addStep = (parentId?: string, branch?: 'yes' | 'no') => {
    if (!selected) return;
    setStepDraft({ workflowId: selected.id, parentId, branch });
  };

  const editStep = (step: WorkflowAction, parentId?: string, branch?: 'yes' | 'no') => {
    if (!selected) return;
    setStepDraft({ workflowId: selected.id, step, parentId, branch });
  };

  const renderSteps = (list: WorkflowAction[], parentId?: string, branch?: 'yes' | 'no'): ReactElement[] =>
    list.map((step, index) => {
      const tools = (
        <div className="flow__node-tools">
          <button
            type="button"
            className="icon-btn"
            aria-label={`Move ${step.label} up`}
            disabled={index === 0}
            onClick={() =>
              dispatch({ type: 'workflow/step/move', workflowId: selected!.id, id: step.id, direction: 'up' })
            }
          >
            <Icon name="chevron-up" size={13} />
          </button>
          <button
            type="button"
            className="icon-btn"
            aria-label={`Move ${step.label} down`}
            disabled={index === list.length - 1}
            onClick={() =>
              dispatch({ type: 'workflow/step/move', workflowId: selected!.id, id: step.id, direction: 'down' })
            }
          >
            <Icon name="chevron-down" size={13} />
          </button>
          <button
            type="button"
            className="icon-btn"
            aria-label={`Edit ${step.label}`}
            onClick={() => editStep(step, parentId, branch)}
          >
            <Icon name="edit" size={13} />
          </button>
          <button
            type="button"
            className="icon-btn"
            aria-label={`Remove ${step.label}`}
            onClick={() =>
              dispatch({ type: 'workflow/step/delete', workflowId: selected!.id, id: step.id })
            }
          >
            <Icon name="trash" size={13} />
          </button>
        </div>
      );

      const node = (current: WorkflowAction) => (
        <>
          <span className="flow__node-icon">
            <Icon name={ACTION_ICON[current.kind]} size={13} />
          </span>
          <button type="button" className="flow__node-main" onClick={() => editStep(current, parentId, branch)}>
            <span>{current.label}</span>
            <span className="flow__node-meta">{stepMeta(current)}</span>
          </button>
          {tools}
        </>
      );

      if (step.kind === 'condition') {
        return (
          <div className="flow__condition" key={step.id}>
            <div className="flow__node flow__node--edit">{node(step)}</div>
            <div className="flow__branches">
              {(['yes', 'no'] as const).map((side) => {
                const branchSteps = step[side] ?? [];
                return (
                  <div className={`flow__branch flow__branch--${side}`} key={side}>
                    <div className="flow__branch-head">
                      <span className="flow__branch-label">{side === 'yes' ? 'Yes' : 'No'}</span>
                      <span className="cell-sub">{branchSteps.length} step{branchSteps.length === 1 ? '' : 's'}</span>
                    </div>
                    {branchSteps.length === 0 ? (
                      <div className="flow__branch-empty">Nothing runs on this path yet.</div>
                    ) : (
                      renderSteps(branchSteps, step.id, side)
                    )}
                    <button
                      type="button"
                      className="flow__add"
                      onClick={() => addStep(step.id, side)}
                    >
                      <Icon name="plus" size={12} /> Add step
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        );
      }

      return (
        <div className="flow__node flow__node--edit" key={step.id}>
          {node(step)}
        </div>
      );
    });

  return (
    <div className="content">
      <PageHeader
        title="Workflows"
        subtitle="Automations that run on triggers, waits, if/else branches and webhooks."
        actions={
          <button className="btn btn--primary" onClick={() => setCreating(true)}>
            <Icon name="plus" size={16} /> New workflow
          </button>
        }
      />

      <div className="grid grid--4" style={{ marginBottom: 16 }}>
        <StatCard label="Live workflows" value={`${live.length}/${state.workflows.length}`} icon={<Icon name="zap" size={15} />} meta="published" />
        <StatCard label="Ever enrolled" value={num(enrolled)} icon={<Icon name="users" size={15} />} meta="across all flows" />
        <StatCard
          label="Test runs"
          value={num(state.workflowRuns.length)}
          icon={<Icon name="play" size={15} />}
          meta={`${succeeded} passed · ${state.workflowRuns.length - succeeded} failed`}
        />
        <StatCard
          label="Steps"
          value={String(state.workflows.reduce((s, w) => s + countSteps(w.actions), 0))}
          icon={<Icon name="sliders" size={15} />}
          meta="including branches"
        />
      </div>

      <div className="grid grid--sidebar">
        <div className="stack">
          {state.workflows.map((w) => (
            <div
              key={w.id}
              className="card"
              style={{
                borderColor: w.id === selectedId ? 'var(--accent)' : undefined,
                boxShadow: w.id === selectedId ? '0 0 0 3px var(--accent-soft)' : undefined,
              }}
            >
              <div className="card__head" style={{ borderBottom: 'none' }}>
                <span
                  className="avatar avatar--md avatar--square"
                  style={{
                    background: w.status === 'published' ? 'var(--green-soft)' : 'var(--surface-3)',
                    color: w.status === 'published' ? 'var(--green)' : 'var(--text-3)',
                  }}
                >
                  <Icon name="zap" size={17} />
                </span>
                <button type="button" className="wf-head" onClick={() => setSelectedId(w.id)}>
                  <span className="row" style={{ gap: 8 }}>
                    <strong style={{ fontSize: 13.5 }}>{w.name}</strong>
                    <StatusBadge status={w.status} />
                  </span>
                  <span className="cell-sub" style={{ display: 'block' }}>
                    Trigger: {triggerText(w.trigger)} · {countSteps(w.actions)} steps
                  </span>
                </button>
                <div className="card__actions">
                  <div style={{ textAlign: 'right', marginRight: 6 }}>
                    <div style={{ fontSize: 13, fontWeight: 650 }}>{num(w.enrolled)}</div>
                    <div className="cell-sub">enrolled</div>
                  </div>
                  <Switch on={w.status === 'published'} label={`Toggle ${w.name}`} onChange={() => dispatch({ type: 'workflow/toggle', id: w.id })} />
                </div>
              </div>
              <button type="button" className="wf-steps" onClick={() => setSelectedId(w.id)}>
                {w.actions.length === 0 ? (
                  <span className="cell-sub">No steps yet — open the flow to add one</span>
                ) : (
                  <span className="row" style={{ gap: 6 }}>
                    {w.actions.slice(0, 6).map((a, i) => (
                      <span key={a.id} className="row" style={{ gap: 6 }}>
                        {i > 0 && <Icon name="chevron-right" size={12} style={{ color: 'var(--text-3)' }} />}
                        <span className="tag" style={{ background: 'var(--surface-3)' }} title={a.label}>
                          <Icon name={ACTION_ICON[a.kind]} size={11} /> {a.kind}
                        </span>
                      </span>
                    ))}
                  </span>
                )}
              </button>
            </div>
          ))}
        </div>

        <div className="card" style={{ position: 'sticky', top: 0 }}>
          {!selected ? (
            <EmptyState icon={<Icon name="zap" size={20} />} title="Select a workflow" />
          ) : (
            <>
              <div className="card__head">
                <div style={{ minWidth: 0 }}>
                  <div className="card__title">{selected.name}</div>
                  <div className="card__sub">
                    {num(selected.enrolled)} enrolled · {num(selected.completed)} completed · {runsFor.length} runs
                  </div>
                </div>
                <div className="card__actions">
                  <Badge tone={selected.status === 'published' ? 'green' : 'default'} dot>
                    {selected.status}
                  </Badge>
                  <button type="button" className="btn btn--sm" onClick={() => setRunFor(selected)}>
                    <Icon name="play" size={13} /> Run now
                  </button>
                  <button
                    type="button"
                    className="icon-btn"
                    aria-label={`Edit ${selected.name} details`}
                    onClick={() => setEditingDetails(selected)}
                  >
                    <Icon name="edit" size={15} />
                  </button>
                </div>
              </div>
              <div className="card__body">
                <div className="flow">
                  <span className="flow__trigger">
                    <Icon name={TRIGGER_ICON[selected.trigger.kind]} size={13} /> {triggerText(selected.trigger)}
                  </span>
                  {renderSteps(selected.actions)}
                  <button type="button" className="flow__add" onClick={() => addStep()}>
                    <Icon name="plus" size={14} /> Add step
                  </button>
                  <div className="flow__node" style={{ borderStyle: 'dashed', color: 'var(--text-3)' }}>
                    <span className="flow__node-icon" style={{ background: 'var(--surface-3)', color: 'var(--text-3)' }}>
                      <Icon name="check" size={13} />
                    </span>
                    <div>Goal reached — exit workflow</div>
                  </div>
                </div>
                <div className="divider" style={{ margin: '14px 0' }} />
                <div className="row row--between">
                  <span className="hint">Completion rate</span>
                  <strong style={{ fontSize: 13 }}>{pct(selected.completed, selected.enrolled || 1)}</strong>
                </div>
                <div style={{ height: 7, background: 'var(--surface-3)', borderRadius: 99, overflow: 'hidden', marginTop: 7 }}>
                  <div style={{ width: pct(selected.completed, selected.enrolled || 1), height: '100%', background: 'var(--green)' }} />
                </div>
              </div>
            </>
          )}
        </div>
      </div>

      <div className="card" style={{ marginTop: 16 }}>
        <div className="card__head">
          <div>
            <div className="card__title">Recent runs</div>
            <div className="card__sub">Simulated test runs — nothing is sent and no requests leave the workspace.</div>
          </div>
          <Badge>{state.workflowRuns.length} total</Badge>
        </div>
        {state.workflowRuns.length === 0 ? (
          <EmptyState
            icon={<Icon name="play" size={20} />}
            title="No runs yet"
            text="Pick a workflow and use Run now to trace it against a contact."
          />
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Workflow</th>
                  <th>Contact</th>
                  <th>Steps</th>
                  <th>Status</th>
                  <th>When</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {state.workflowRuns.map((run) => {
                  const flow = state.workflows.find((w) => w.id === run.workflowId);
                  return (
                    <tr key={run.id} className="is-clickable" onClick={() => setViewingRun(run)}>
                      <td>
                        <div className="cell-main">{flow?.name ?? 'Workflow'}</div>
                        <div className="cell-sub">{run.steps.length} steps · {(run.durationMs / 1000).toFixed(1)}s</div>
                      </td>
                      <td>{contactName(run.contactId)}</td>
                      <td className="cell-num">{run.steps.length}</td>
                      <td>
                        <Badge tone={run.status === 'success' ? 'green' : 'red'} dot>
                          {run.status === 'success' ? 'Success' : 'Failed'}
                        </Badge>
                      </td>
                      <td className="cell-sub">{relative(run.at)}</td>
                      <td className="cell-right">
                        <button
                          type="button"
                          className="btn btn--sm"
                          onClick={(e) => {
                            e.stopPropagation();
                            setViewingRun(run);
                          }}
                        >
                          View
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

      {creating && (
        <WorkflowDetails
          onClose={() => setCreating(false)}
          onSave={(name, trigger) => {
            const id = uid('wf');
            dispatch({
              type: 'workflow/add',
              workflow: { id, name, status: 'draft', trigger, actions: [], enrolled: 0, completed: 0 },
            });
            setSelectedId(id);
            setCreating(false);
          }}
        />
      )}

      {editingDetails && (
        <WorkflowDetails
          workflow={editingDetails}
          onClose={() => setEditingDetails(null)}
          onSave={(name, trigger) => {
            dispatch({ type: 'workflow/update', id: editingDetails.id, patch: { name, trigger } });
            setEditingDetails(null);
          }}
        />
      )}

      {stepDraft && (
        <StepModal
          step={stepDraft.step}
          allowCondition={!stepDraft.parentId}
          onClose={() => setStepDraft(null)}
          onSave={(step) => {
            if (stepDraft.step) {
              dispatch({ type: 'workflow/step/update', workflowId: stepDraft.workflowId, id: stepDraft.step.id, patch: step });
            } else {
              dispatch({
                type: 'workflow/step/add',
                workflowId: stepDraft.workflowId,
                step: { ...step, id: uid('wa') },
                parentId: stepDraft.parentId,
                branch: stepDraft.branch,
              });
            }
            setStepDraft(null);
          }}
        />
      )}

            {showTemplates && (
        <TemplateGalleryModal
          onClose={() => setShowTemplates(false)}
          onInstall={(tpl) => {
            const newFlow: Workflow = {
              id: uid('wf'),
              name: tpl.name,
              status: 'published',
              trigger: tpl.trigger,
              actions: tpl.actions,
              enrolled: 0,
              completed: 0,
            };
            dispatch({ type: 'workflow/add', workflow: newFlow });
            setSelectedId(newFlow.id);
            setShowTemplates(false);
          }}
        />
      )}

      {runFor && (
        <RunPicker
          flow={runFor}
          contacts={state.contacts}
          onClose={() => setRunFor(null)}
          onRun={(contact) => {
            const run = simulateRun(runFor, contact);
            dispatch({ type: 'workflow/run/add', run });
            setRunFor(null);
            setViewingRun(run);
          }}
        />
      )}

      {viewingRun && (
        <RunResult
          run={viewingRun}
          flow={state.workflows.find((w) => w.id === viewingRun.workflowId)}
          contact={state.contacts.find((c) => c.id === viewingRun.contactId)}
          onClose={() => setViewingRun(null)}
        />
      )}
    </div>
  );
}

function WorkflowDetails({
  workflow,
  onClose,
  onSave,
}: {
  workflow?: Workflow;
  onClose: () => void;
  onSave: (name: string, trigger: WorkflowTrigger) => void;
}) {
  const { state } = useStore();
  const formNames = state.forms.map((form) => form.name);
  const [name, setName] = useState(workflow?.name ?? '');
  const [kind, setKind] = useState<WorkflowTriggerKind>(workflow?.trigger.kind ?? 'form');
  const [formName, setFormName] = useState(
    workflow?.trigger.kind === 'form' ? (workflow.trigger.detail ?? formNames[0] ?? '') : formNames[0] ?? '',
  );
  const [tagName, setTagName] = useState(workflow?.trigger.kind === 'tag' ? (workflow.trigger.detail ?? '') : '');
  const [hookPath, setHookPath] = useState(
    workflow?.trigger.kind === 'webhook' ? (workflow.trigger.detail ?? '') : 'inbound/lead',
  );
  const [every, setEvery] = useState(String(workflow?.trigger.every ?? 1));
  const [unit, setUnit] = useState<NonNullable<WorkflowTrigger['unit']>>(workflow?.trigger.unit ?? 'days');

  const interval = Number(every);
  const detailValid =
    kind === 'form'
      ? formName.trim().length > 0
      : kind === 'tag'
        ? tagName.trim().length > 0
        : kind === 'webhook'
          ? hookPath.trim().replace(/^\/+/, '').length > 0
          : true;
  const scheduleValid = kind !== 'schedule' || (Number.isFinite(interval) && interval >= 1);
  const canSave = name.trim().length > 1 && detailValid && scheduleValid;

  const buildTrigger = (): WorkflowTrigger => {
    if (kind === 'form') return { kind, detail: formName };
    if (kind === 'tag') return { kind, detail: tagName.trim().replace(/^#/, '') };
    if (kind === 'webhook') return { kind, detail: hookPath.trim().replace(/^\/+/, '') };
    if (kind === 'schedule') return { kind, every: Math.max(1, Math.round(interval || 1)), unit };
    return { kind };
  };

  return (
    <Modal
      title={workflow ? 'Workflow details' : 'New workflow'}
      onClose={onClose}
      footer={
        <>
          <button className="btn" type="button" onClick={onClose}>
            Cancel
          </button>
          <button
            className="btn btn--primary"
            type="button"
            disabled={!canSave}
            onClick={() => onSave(name.trim(), buildTrigger())}
          >
            {workflow ? 'Save changes' : 'Create workflow'}
          </button>
        </>
      }
    >
      <div className="field">
        <label htmlFor="workflow-name">Name</label>
        <input
          id="workflow-name"
          className="input"
          autoFocus
          placeholder="New client onboarding"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </div>
      <div className="field" style={{ marginTop: 12 }}>
        <label htmlFor="workflow-trigger-kind">Trigger</label>
        <select
          id="workflow-trigger-kind"
          className="select"
          value={kind}
          onChange={(e) => setKind(e.target.value as WorkflowTriggerKind)}
        >
          {TRIGGER_KINDS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </div>

      {kind === 'form' && (
        <div className="field" style={{ marginTop: 12 }}>
          <label htmlFor="workflow-trigger-form">Form</label>
          <select
            id="workflow-trigger-form"
            className="select"
            value={formName}
            onChange={(e) => setFormName(e.target.value)}
          >
            {formNames.length === 0 && <option value="">No forms yet</option>}
            {formNames.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </div>
      )}

      {kind === 'tag' && (
        <div className="field" style={{ marginTop: 12 }}>
          <label htmlFor="workflow-trigger-tag">Tag</label>
          <input
            id="workflow-trigger-tag"
            className="input"
            placeholder="replied"
            value={tagName}
            onChange={(e) => setTagName(e.target.value)}
          />
        </div>
      )}

      {kind === 'webhook' && (
        <div className="field" style={{ marginTop: 12 }}>
          <label htmlFor="workflow-trigger-path">Inbound path</label>
          <input
            id="workflow-trigger-path"
            className="input"
            placeholder="inbound/lead"
            style={{ fontFamily: 'var(--font-mono)' }}
            value={hookPath}
            onChange={(e) => setHookPath(e.target.value)}
          />
          <div className="hint" style={{ marginTop: 6, fontFamily: 'var(--font-mono)' }}>
            https://hooks.agency.test/{hookPath.trim().replace(/^\/+/, '') || 'inbound/lead'}
          </div>
        </div>
      )}

      {kind === 'schedule' && (
        <div className="grid grid--2" style={{ marginTop: 12 }}>
          <div className="field">
            <label htmlFor="workflow-trigger-every">Repeat every</label>
            <input
              id="workflow-trigger-every"
              className="input"
              type="number"
              min="1"
              step="1"
              value={every}
              onChange={(e) => setEvery(e.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor="workflow-trigger-unit">Unit</label>
            <select
              id="workflow-trigger-unit"
              className="select"
              value={unit}
              onChange={(e) => setUnit(e.target.value as NonNullable<WorkflowTrigger['unit']>)}
            >
              <option value="minutes">Minutes</option>
              <option value="hours">Hours</option>
              <option value="days">Days</option>
            </select>
          </div>
        </div>
      )}

      <div className="hint" style={{ marginTop: 12 }}>
        {TRIGGER_HINT[kind]}
        {workflow ? ' Changing the trigger does not affect contacts already enrolled.' : ''}
      </div>
    </Modal>
  );
}

function StepModal({
  step,
  allowCondition,
  onClose,
  onSave,
}: {
  step?: WorkflowAction;
  allowCondition: boolean;
  onClose: () => void;
  onSave: (step: Omit<WorkflowAction, 'id'>) => void;
}) {
  const kinds = allowCondition ? KINDS : KINDS.filter((option) => option.value !== 'condition');
  const [kind, setKind] = useState<WorkflowAction['kind']>(step?.kind ?? 'email');
  const [label, setLabel] = useState(step?.label ?? KINDS[0].defaultLabel);
  const [delay, setDelay] = useState(String(step?.delayHours ?? 24));
  const [method, setMethod] = useState<NonNullable<WorkflowStepConfig['method']>>(step?.config?.method ?? 'POST');
  const [url, setUrl] = useState(step?.config?.url ?? '');
  const [tagName, setTagName] = useState(step?.config?.tag ?? '');
  const [taskTitle, setTaskTitle] = useState(step?.config?.title ?? '');
  const [dueDays, setDueDays] = useState(String(step?.config?.dueInDays ?? 1));
  const [field, setField] = useState<ConditionField>(step?.config?.rule?.field ?? 'status');
  const [operator, setOperator] = useState<ConditionOperator>(step?.config?.rule?.operator ?? 'is');
  const [value, setValue] = useState(step?.config?.rule?.value ?? 'customer');

  const hours = Number(delay);
  const trimmedUrl = url.trim();
  const urlValid = trimmedUrl === '' || /^https?:\/\/\S+$/i.test(trimmedUrl);
  const canSave =
    label.trim().length > 1 &&
    (kind !== 'wait' || (Number.isFinite(hours) && hours > 0)) &&
    (kind !== 'webhook' || urlValid) &&
    (kind !== 'tag' || tagName.trim().length > 0) &&
    (kind !== 'task' || taskTitle.trim().length > 0) &&
    (kind !== 'condition' || value.trim().length > 0);

  const changeKind = (next: WorkflowAction['kind']) => {
    const previousDefault = KINDS.find((option) => option.value === kind)?.defaultLabel ?? '';
    setKind(next);
    if (!label.trim() || label === previousDefault) {
      setLabel(KINDS.find((option) => option.value === next)?.defaultLabel ?? '');
    }
    if (next === 'task' && !taskTitle.trim()) setTaskTitle('Create follow-up task');
    if (next === 'tag' && !tagName.trim()) setTagName('nurtured');
  };

  const changeField = (next: ConditionField) => {
    setField(next);
    if (next === 'status' && !STATUS_VALUES.includes(value as Contact['status'])) {
      setValue('customer');
    }
  };

  const buildConfig = (): WorkflowStepConfig | undefined => {
    if (kind === 'webhook') return { method, url: trimmedUrl };
    if (kind === 'tag') return { tag: tagName.trim().replace(/^#/, '') };
    if (kind === 'task') {
      return { title: taskTitle.trim(), dueInDays: Math.max(0, Math.round(Number(dueDays) || 0)) };
    }
    if (kind === 'condition') return { rule: { field, operator, value: value.trim() } };
    return undefined;
  };

  return (
    <Modal
      title={step ? 'Edit step' : 'Add step'}
      onClose={onClose}
      footer={
        <>
          <button className="btn" type="button" onClick={onClose}>
            Cancel
          </button>
          <button
            className="btn btn--primary"
            type="button"
            disabled={!canSave}
            onClick={() =>
              onSave({
                kind,
                label: label.trim(),
                delayHours: kind === 'wait' ? Math.round(hours) : undefined,
                config: buildConfig(),
              })
            }
          >
            {step ? 'Save step' : 'Add step'}
          </button>
        </>
      }
    >
      <div className="grid grid--2">
        <div className="field">
          <label htmlFor="step-kind">Step type</label>
          <select
            id="step-kind"
            className="select"
            value={kind}
            onChange={(e) => changeKind(e.target.value as WorkflowAction['kind'])}
          >
            {kinds.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="step-label">Label</label>
          <input
            id="step-label"
            className="input"
            placeholder="What does this step do?"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
          />
        </div>
      </div>

      {kind === 'wait' && (
        <div className="field" style={{ marginTop: 12 }}>
          <label htmlFor="step-delay">Wait before the next step (hours)</label>
          <input
            id="step-delay"
            className="input"
            type="number"
            min="1"
            step="1"
            value={delay}
            onChange={(e) => setDelay(e.target.value)}
          />
          <div className="row" style={{ gap: 6, marginTop: 8 }}>
            {[1, 24, 72, 168].map((preset) => (
              <button
                key={preset}
                type="button"
                className={`btn btn--sm${Number(delay) === preset ? ' btn--primary' : ''}`}
                onClick={() => setDelay(String(preset))}
              >
                {delayText(preset)}
              </button>
            ))}
          </div>
        </div>
      )}

      {kind === 'webhook' && (
        <div style={{ marginTop: 12 }}>
          <div className="grid grid--2">
            <div className="field">
              <label htmlFor="step-method">Method</label>
              <select
                id="step-method"
                className="select"
                value={method}
                onChange={(e) => setMethod(e.target.value as NonNullable<WorkflowStepConfig['method']>)}
              >
                <option value="POST">POST</option>
                <option value="PUT">PUT</option>
                <option value="GET">GET</option>
              </select>
            </div>
            <div className="field">
              <label htmlFor="step-url">Endpoint URL</label>
              <input
                id="step-url"
                className="input"
                placeholder="https://hooks.example.com/lead"
                style={{ fontFamily: 'var(--font-mono)' }}
                value={url}
                onChange={(e) => setUrl(e.target.value)}
              />
            </div>
          </div>
          {!urlValid ? (
            <div className="callout callout--danger" style={{ marginTop: 10 }}>
              Use an http:// or https:// URL.
            </div>
          ) : trimmedUrl === '' ? (
            <div className="callout callout--warn" style={{ marginTop: 10 }}>
              Runs will fail at this step until an endpoint is set. Nothing is ever sent from the workspace.
            </div>
          ) : null}
        </div>
      )}

      {kind === 'tag' && (
        <div className="field" style={{ marginTop: 12 }}>
          <label htmlFor="step-tag">Tag to apply</label>
          <input
            id="step-tag"
            className="input"
            placeholder="nurtured"
            value={tagName}
            onChange={(e) => setTagName(e.target.value)}
          />
        </div>
      )}

      {kind === 'task' && (
        <div className="grid grid--2" style={{ marginTop: 12 }}>
          <div className="field">
            <label htmlFor="step-task-title">Task title</label>
            <input
              id="step-task-title"
              className="input"
              placeholder="Call the lead back"
              value={taskTitle}
              onChange={(e) => setTaskTitle(e.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor="step-due">Due in (days)</label>
            <input
              id="step-due"
              className="input"
              type="number"
              min="0"
              step="1"
              value={dueDays}
              onChange={(e) => setDueDays(e.target.value)}
            />
          </div>
        </div>
      )}

      {kind === 'condition' && (
        <div style={{ marginTop: 12 }}>
          <div className="grid grid--3">
            <div className="field">
              <label htmlFor="step-field">Contact field</label>
              <select
                id="step-field"
                className="select"
                value={field}
                onChange={(e) => changeField(e.target.value as ConditionField)}
              >
                {(Object.keys(FIELD_LABELS) as ConditionField[]).map((option) => (
                  <option key={option} value={option}>
                    {FIELD_LABELS[option]}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="step-operator">Operator</label>
              <select
                id="step-operator"
                className="select"
                value={operator}
                onChange={(e) => setOperator(e.target.value as ConditionOperator)}
              >
                {(Object.keys(OPERATOR_LABELS) as ConditionOperator[]).map((option) => (
                  <option key={option} value={option}>
                    {OPERATOR_LABELS[option]}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="step-value">Value</label>
              {field === 'status' ? (
                <select
                  id="step-value"
                  className="select"
                  value={value}
                  onChange={(e) => setValue(e.target.value)}
                >
                  {STATUS_VALUES.map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  id="step-value"
                  className="input"
                  placeholder={field === 'tag' ? 'hot-lead' : field === 'company' ? 'Northwind Studio' : 'name@company.com'}
                  value={value}
                  onChange={(e) => setValue(e.target.value)}
                />
              )}
            </div>
          </div>
          <div className="callout" style={{ marginTop: 10 }}>
            Condition steps open two paths in the flow: steps added under <strong>Yes</strong> run when the rule
            matches, and steps under <strong>No</strong> run otherwise.
          </div>
        </div>
      )}

      <div className="hint" style={{ marginTop: 12 }}>
        {kind === 'wait'
          ? 'Waits pause the contact between the steps above and below. Hours convert into days automatically in the flow.'
          : kind === 'condition'
            ? 'Branches are one level deep — a branch cannot contain another condition.'
            : 'Steps run in order. Use the arrows in the flow to move this step, or the pencil to come back and edit it.'}
      </div>
    </Modal>
  );
}

function RunPicker({
  flow,
  contacts,
  onClose,
  onRun,
}: {
  flow: Workflow;
  contacts: Contact[];
  onClose: () => void;
  onRun: (contact: Contact) => void;
}) {
  const [contactId, setContactId] = useState(contacts[0]?.id ?? '');
  const contact = contacts.find((c) => c.id === contactId) ?? null;

  return (
    <Modal
      title={`Run ${flow.name}`}
      onClose={onClose}
      footer={
        <>
          <button className="btn" type="button" onClick={onClose}>
            Cancel
          </button>
          <button
            className="btn btn--primary"
            type="button"
            disabled={!contact}
            onClick={() => contact && onRun(contact)}
          >
            <Icon name="play" size={13} /> Run workflow
          </button>
        </>
      }
    >
      <div className="callout" style={{ marginBottom: 12 }}>
        This is a simulated test run. Waits finish instantly, conditions are evaluated against the chosen contact, and
        no messages or webhook requests leave the workspace.
      </div>
      <div className="field">
        <label htmlFor="run-contact">Run as contact</label>
        <select
          id="run-contact"
          className="select"
          value={contactId}
          onChange={(e) => setContactId(e.target.value)}
        >
          {contacts.map((option) => (
            <option key={option.id} value={option.id}>
              {option.firstName} {option.lastName} · {option.status}
            </option>
          ))}
        </select>
        <div className="hint" style={{ marginTop: 6 }}>
          Trigger: {triggerText(flow.trigger)} · {countSteps(flow.actions)} steps
        </div>
      </div>
      {contact && (
        <div className="hint" style={{ marginTop: 10 }}>
          Tags: {contact.tags.length ? contact.tags.join(', ') : 'none'} · Company: {contact.company || '—'}
        </div>
      )}
    </Modal>
  );
}

function RunResult({
  run,
  flow,
  contact,
  onClose,
}: {
  run: WorkflowRun;
  flow?: Workflow;
  contact?: Contact;
  onClose: () => void;
}) {
  const done = run.steps.filter((step) => step.status === 'done').length;

  return (
    <Modal
      title={run.status === 'success' ? 'Run succeeded' : 'Run failed'}
      onClose={onClose}
      footer={
        <button className="btn btn--primary" onClick={onClose}>
          Close
        </button>
      }
    >
      <div className="row row--between">
        <div>
          <div className="cell-sub">Workflow</div>
          <strong style={{ fontSize: 13.5 }}>{flow?.name ?? 'Workflow'}</strong>
        </div>
        <Badge tone={run.status === 'success' ? 'green' : 'red'} dot>
          {run.status === 'success' ? 'Success' : 'Failed'}
        </Badge>
      </div>
      <div className="row" style={{ gap: 18, marginTop: 12 }}>
        <div>
          <div className="cell-sub">Contact</div>
          <strong style={{ fontSize: 13 }}>{contact ? `${contact.firstName} ${contact.lastName}` : 'Unknown'}</strong>
        </div>
        <div>
          <div className="cell-sub">Steps completed</div>
          <strong style={{ fontSize: 13 }}>{done}/{run.steps.length}</strong>
        </div>
        <div>
          <div className="cell-sub">Simulated duration</div>
          <strong style={{ fontSize: 13 }}>{(run.durationMs / 1000).toFixed(1)}s</strong>
        </div>
      </div>
      <div className="divider" style={{ margin: '12px 0' }} />
      <div className="stack" style={{ gap: 6 }}>
        {run.steps.map((step, index) => (
          <div
            className="list-row"
            key={`${run.id}-${index}`}
            style={{ border: '1px solid var(--line)', borderRadius: 9, background: 'var(--surface-2)' }}
          >
            <span
              className="avatar avatar--sm avatar--square"
              style={{
                background:
                  step.status === 'failed'
                    ? 'var(--red-soft)'
                    : step.status === 'skipped'
                      ? 'var(--surface-3)'
                      : 'var(--green-soft)',
                color:
                  step.status === 'failed'
                    ? 'var(--red)'
                    : step.status === 'skipped'
                      ? 'var(--text-3)'
                      : 'var(--green)',
              }}
            >
              <Icon name={ACTION_ICON[step.kind]} size={13} />
            </span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 12.5, fontWeight: 600 }}>{step.label}</div>
              <div className="cell-sub">{step.detail ?? step.kind}</div>
            </div>
            <Badge
              tone={step.status === 'failed' ? 'red' : step.status === 'skipped' ? 'default' : 'green'}
            >
              {step.status}
            </Badge>
          </div>
        ))}
      </div>
    </Modal>
  );
}


interface TemplateDef {
  name: string;
  category: string;
  description: string;
  trigger: WorkflowTrigger;
  actions: WorkflowAction[];
}

function TemplateGalleryModal({
  onClose,
  onInstall,
}: {
  onClose: () => void;
  onInstall: (t: TemplateDef) => void;
}) {
  const templates: TemplateDef[] = [
    {
      name: 'Instant Lead Capture & SMS Dispatch',
      category: 'Lead Capture & Nurture',
      description: 'Ingests new website form submissions, tags the contact, sends a welcome SMS, and creates a follow-up task.',
      trigger: { kind: 'form', detail: 'Inbound Contact Form' },
      actions: [
        { id: uid('act'), kind: 'tag', label: 'Tag hot-inbound', config: { tag: 'hot-inbound' } },
        { id: uid('act'), kind: 'sms', label: 'Send Welcome SMS', config: {} },
        { id: uid('act'), kind: 'task', label: 'Create sales follow-up task', config: { title: 'Call new lead' } },
      ],
    },
    {
      name: 'Opportunity Won - Customer Onboarding & Review',
      category: 'Sales Pipeline Automation',
      description: 'Fires when a payment or deal is won. Delivers an onboarding email, waits 24 hours, and creates a client check-in task.',
      trigger: { kind: 'payment', detail: 'Deal Closed / Paid' },
      actions: [
        { id: uid('act'), kind: 'email', label: 'Send Welcome Email', config: {} },
        { id: uid('act'), kind: 'wait', label: 'Wait 24 hours', delayHours: 24 },
        { id: uid('act'), kind: 'task', label: 'Check in on onboarding', config: { title: 'Onboarding check-in call' } },
      ],
    },
    {
      name: 'Inbound Webhook to Pipeline & Slack Dispatch',
      category: 'Omnichannel & Integrations',
      description: 'Listens for webhooks from Zapier or n8n, tags the contact, dispatches to an internal webhook, and creates an intake task.',
      trigger: { kind: 'webhook', detail: 'External Inbound Lead' },
      actions: [
        { id: uid('act'), kind: 'tag', label: 'Tag webhook-lead', config: { tag: 'webhook-lead' } },
        { id: uid('act'), kind: 'webhook', label: 'POST to Slack / Discord', config: { method: 'POST', url: 'https://hooks.slack.com/services/demo' } },
        { id: uid('act'), kind: 'task', label: 'Review incoming webhook lead', config: { title: 'Qualify lead from external webhook' } },
      ],
    },
  ];

  return (
    <Modal title="Pre-built Automation Templates" onClose={onClose} wide>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <p style={{ color: 'var(--text-3)', fontSize: 13, margin: 0 }}>
          Install ready-to-use production workflows with triggers, branching, and actions in one click.
        </p>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 12 }}>
          {templates.map((tpl) => (
            <div
              key={tpl.name}
              className="card"
              style={{
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'space-between',
                padding: 16,
                borderRadius: 10,
                border: '1px solid var(--border)',
                background: 'var(--surface-2)',
              }}
            >
              <div>
                <span className="badge badge--primary" style={{ fontSize: 10.5, marginBottom: 8, display: 'inline-block' }}>
                  {tpl.category}
                </span>
                <h4 style={{ margin: '0 0 6px 0', fontSize: 14, color: 'var(--text-1)' }}>{tpl.name}</h4>
                <p style={{ fontSize: 12, color: 'var(--text-3)', lineHeight: 1.4, margin: 0 }}>{tpl.description}</p>
                <div style={{ fontSize: 11.5, color: 'var(--text-2)', marginTop: 10 }}>
                  <strong>{tpl.actions.length}</strong> automated steps
                </div>
              </div>
              <button
                type="button"
                className="btn btn--primary btn--sm"
                style={{ marginTop: 14, width: '100%' }}
                onClick={() => onInstall(tpl)}
              >
                <Icon name="plus" size={13} /> Install Template
              </button>
            </div>
          ))}
        </div>
      </div>
    </Modal>
  );
}


