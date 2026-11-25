import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Icon } from '../components/Icon';
import { Modal } from '../components/Modal';
import { Avatar, Badge, EmptyState, ErrorState, LoadingState } from '../components/ui';
import { useAuth } from '../lib/AuthContext';
import { useContacts, useTaskMutations, useTasks } from '../hooks/useWorkspaceData';
import { shortDate, timeOf, toDateTimeInput } from '../lib/format';
import type { Task, TaskPriority } from '../lib/types';

const PRIORITY: Record<TaskPriority, { label: string; tone: 'default' | 'amber' | 'red' }> = {
  high: { label: 'High', tone: 'red' },
  medium: { label: 'Medium', tone: 'amber' },
  low: { label: 'Low', tone: 'default' },
};

type Filter = 'open' | 'done' | 'all';

function mapApiTask(t: any): Task {
  return {
    id: t.id,
    title: t.title || 'Follow-up Task',
    contactId: t.contactId || undefined,
    assignee: t.assignedTo || 'Operator',
    dueAt: t.dueDate || t.createdAt || new Date().toISOString(),
    priority: (t.priority === 'high' ? 'high' : t.priority === 'low' ? 'low' : 'medium') as TaskPriority,
    done: t.status === 'completed',
    createdAt: t.createdAt || new Date().toISOString(),
  };
}

export default function Tasks() {
  const tasksQuery = useTasks();
  const contactsQuery = useContacts();
  const mutations = useTaskMutations();
  const [filter, setFilter] = useState<Filter>('open');
  const [query, setQuery] = useState('');
  const [adding, setAdding] = useState(false);

  const allTasks = useMemo(() => {
    const raw = tasksQuery.data?.data ?? tasksQuery.data?.tasks ?? [];
    return raw.map(mapApiTask);
  }, [tasksQuery.data]);

  const contacts = contactsQuery.data?.data ?? [];
  const now = Date.now();
  const contactName = (id?: string) => {
    const c = id ? contacts.find((x: any) => x.id === id) : undefined;
    return c ? `${c.firstName} ${c.lastName}` : null;
  };

  const tasks = useMemo(() => {
    const q = query.trim().toLowerCase();
    return allTasks
      .filter((t) => {
        if (filter === 'open' && t.done) return false;
        if (filter === 'done' && !t.done) return false;
        if (!q) return true;
        return `${t.title} ${t.assignee} ${contactName(t.contactId) ?? ''}`.toLowerCase().includes(q);
      })
      .sort((a, b) => a.dueAt.localeCompare(b.dueAt));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allTasks, contacts, filter, query]);

  const open = allTasks.filter((t) => !t.done);
  const overdue = open.filter((t) => new Date(t.dueAt).getTime() < now);
  const dueToday = open.filter((t) => {
    const due = new Date(t.dueAt);
    const today = new Date(now);
    return (
      due.getDate() === today.getDate() &&
      due.getMonth() === today.getMonth() &&
      due.getFullYear() === today.getFullYear()
    );
  });
  const completed = allTasks.filter((t) => t.done);

  const openTasks = tasks.filter((t) => !t.done);
  const groups = [
    { key: 'overdue', label: 'Overdue', items: openTasks.filter((t) => new Date(t.dueAt).getTime() < now) },
    {
      key: 'today',
      label: 'Today',
      items: openTasks.filter((t) => {
        if (new Date(t.dueAt).getTime() < now) return false;
        return dueToday.some((d) => d.id === t.id);
      }),
    },
    {
      key: 'upcoming',
      label: 'Upcoming',
      items: openTasks.filter(
        (t) => new Date(t.dueAt).getTime() >= now && !dueToday.some((d) => d.id === t.id),
      ),
    },
  ].filter((g) => g.items.length > 0);

  const doneTasks = tasks.filter((t) => t.done);

  return (
    <main className="operza-dashboard atlas-dashboard">
      <header className="atlas-dashboard__header">
        <div className="atlas-dashboard__heading">
          <div className="atlas-dashboard__breadcrumb">Workspace <span>/</span> Action Center</div>
          <h1>Tasks</h1>
        </div>
        <div className="atlas-dashboard__toolbar">
          <button className="atlas-quick-action-button" onClick={() => setAdding(true)}>
            <Icon name="plus" size={13} /> New Task
          </button>
        </div>
      </header>

      <section className="atlas-hero">
        <div className="atlas-eyebrow">ACTION ITEMS &amp; TEAM ACCOUNTABILITY</div>
        <h2>Operational Follow-Ups &amp; Due Dates</h2>
        <p>Prioritized action queues across customer relationships, opportunities, and automated workflow triggers.</p>
      </section>

      <section className="atlas-kpis" aria-label="Task metrics">
        <article className="operza-kpi atlas-kpi">
          <div className="operza-kpi__header">
            <span className="operza-kpi__icon"><Icon name="task" size={15} /></span>
            <span className="operza-kpi__trend">Active</span>
          </div>
          <div className="atlas-kpi__label">Open Tasks</div>
          <div className="atlas-kpi__value tabular">{open.length}</div>
          <div className="atlas-kpi__note">Pending completion</div>
        </article>

        <article className="operza-kpi atlas-kpi">
          <div className="operza-kpi__header">
            <span className="operza-kpi__icon"><Icon name="clock" size={15} /></span>
            <span className="operza-kpi__trend">Urgent</span>
          </div>
          <div className="atlas-kpi__label">Overdue</div>
          <div className="atlas-kpi__value tabular">{overdue.length}</div>
          <div className="atlas-kpi__note">Past due deadline</div>
        </article>

        <article className="operza-kpi atlas-kpi">
          <div className="operza-kpi__header">
            <span className="operza-kpi__icon"><Icon name="calendar" size={15} /></span>
            <span className="operza-kpi__trend">Today</span>
          </div>
          <div className="atlas-kpi__label">Due Today</div>
          <div className="atlas-kpi__value tabular">{dueToday.length}</div>
          <div className="atlas-kpi__note">Due before EOD</div>
        </article>

        <article className="operza-kpi atlas-kpi">
          <div className="operza-kpi__header">
            <span className="operza-kpi__icon"><Icon name="check" size={15} /></span>
            <span className="operza-kpi__trend">Done</span>
          </div>
          <div className="atlas-kpi__label">Completed</div>
          <div className="atlas-kpi__value tabular">{completed.length}</div>
          <div className="atlas-kpi__note">All-time executed</div>
        </article>
      </section>

      <section className="card-premium" style={{ marginTop: 22, padding: '20px 24px' }}>
        <div className="card__head" style={{ gap: 8, flexWrap: 'wrap' }}>
          <div className="segmented">
            {(['open', 'done', 'all'] as const).map((f) => (
              <button key={f} className={filter === f ? 'is-active' : ''} onClick={() => setFilter(f)}>
                {f === 'open' ? 'Open' : f === 'done' ? 'Done' : 'All'}
              </button>
            ))}
          </div>
          <div className="search" style={{ width: 240 }}>
            <Icon name="search" size={15} />
            <input
              className="input"
              placeholder="Search tasks…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
          <span className="spacer" />
          <span className="hint">{tasks.length} shown</span>
        </div>

        {tasksQuery.isLoading ? (
          <LoadingState message="Loading tasks..." />
        ) : tasksQuery.isError ? (
          <ErrorState
            title="Failed to load tasks"
            message={(tasksQuery.error as Error)?.message}
            onRetry={() => tasksQuery.refetch()}
          />
        ) : tasks.length === 0 ? (
          <EmptyState
            icon={<Icon name="task" size={22} />}
            title="Nothing here"
            text="Create a task to keep the next step visible."
            action={
              <button className="btn btn--sm" onClick={() => setAdding(true)}>
                New task
              </button>
            }
          />
        ) : (
          <>
            {groups.map((group) => (
              <div key={group.key}>
                <div className={`task-group task-group--${group.key}`}>{group.label}</div>
                {group.items.map((t) => (
                  <TaskRow
                    key={t.id}
                    task={t}
                    contacts={contacts}
                    onToggle={() => mutations.update.mutate({ id: t.id, patch: { status: t.done ? 'pending' : 'completed' } })}
                    onDelete={() => mutations.remove.mutate(t.id)}
                  />
                ))}
              </div>
            ))}
            {doneTasks.length > 0 && (
              <div>
                <div className="task-group">Done</div>
                {doneTasks.map((t) => (
                  <TaskRow
                    key={t.id}
                    task={t}
                    contacts={contacts}
                    onToggle={() => mutations.update.mutate({ id: t.id, patch: { status: t.done ? 'pending' : 'completed' } })}
                    onDelete={() => mutations.remove.mutate(t.id)}
                  />
                ))}
              </div>
            )}
          </>
        )}
      </section>

      {adding && (
        <NewTask
          contacts={contacts}
          isSaving={mutations.create.isPending}
          errorMessage={mutations.create.isError ? (mutations.create.error as Error).message : undefined}
          onSave={async (payload) => {
            await mutations.create.mutateAsync(payload);
            setAdding(false);
          }}
          onClose={() => setAdding(false)}
        />
      )}
    </main>
  );
}

function TaskRow({
  task,
  contacts,
  onToggle,
  onDelete,
}: {
  task: Task;
  contacts: any[];
  onToggle: () => void;
  onDelete: () => void;
}) {
  const contact = task.contactId ? contacts.find((c) => c.id === task.contactId) : undefined;
  const priority = PRIORITY[task.priority];

  return (
    <div className={`task${task.done ? ' is-done' : ''}`}>
      <button
        type="button"
        className="task__check"
        role="checkbox"
        aria-checked={task.done}
        aria-label={task.done ? `Reopen ${task.title}` : `Complete ${task.title}`}
        onClick={onToggle}
      >
        {task.done && <Icon name="check" size={13} />}
      </button>
      <div className="task__body">
        <div className="task__title">{task.title}</div>
        <div className="task__meta">
          {contact && (
            <Link className="task__contact" to={`/contacts/${contact.id}`}>
              {contact.firstName} {contact.lastName}
            </Link>
          )}
          {contact && <span className="task__dot">·</span>}
          <span>{task.assignee}</span>
          <span className="task__dot">·</span>
          <span className={!task.done && new Date(task.dueAt).getTime() < Date.now() ? 'task__late' : undefined}>
            {shortDate(task.dueAt)}, {timeOf(task.dueAt)}
          </span>
        </div>
      </div>
      <Badge tone={priority.tone}>{priority.label}</Badge>
      <button
        type="button"
        className="icon-btn"
        aria-label={`Delete ${task.title}`}
        onClick={onDelete}
      >
        <Icon name="trash" size={15} />
      </button>
    </div>
  );
}

function NewTask({
  contacts,
  isSaving,
  errorMessage,
  onSave,
  onClose,
}: {
  contacts: any[];
  isSaving: boolean;
  errorMessage?: string;
  onSave: (payload: any) => Promise<void>;
  onClose: () => void;
}) {
  const { user } = useAuth();
  const [title, setTitle] = useState('');
  const [contactId, setContactId] = useState('');
  const [assignee, setAssignee] = useState(user?.name || 'Operator');
  const [priority, setPriority] = useState<TaskPriority>('medium');
  const [due, setDue] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    d.setHours(9, 0, 0, 0);
    return toDateTimeInput(d);
  });

  const canSave = title.trim().length > 1 && !!due && !isSaving;

  const save = async () => {
    if (!canSave) return;
    await onSave({
      title: title.trim(),
      contactId: contactId || undefined,
      assignedTo: assignee.trim(),
      dueDate: new Date(due).toISOString(),
      priority,
      status: 'pending',
    });
  };

  return (
    <Modal
      title="New task"
      onClose={onClose}
      footer={
        <>
          <button className="btn" type="button" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn--primary" type="button" disabled={!canSave} onClick={save}>
            {isSaving ? 'Creating...' : 'Create task'}
          </button>
        </>
      }
    >
      {errorMessage && (
        <div className="callout callout--warn" role="alert" style={{ marginBottom: 12 }}>
          {errorMessage}
        </div>
      )}
      <div className="field">
        <label htmlFor="task-title">Task</label>
        <input
          id="task-title"
          className="input"
          autoFocus
          placeholder="Call about the proposal"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
      </div>
      <div className="grid grid--2" style={{ marginTop: 12 }}>
        <div className="field">
          <label htmlFor="task-contact">Contact</label>
          <select id="task-contact" className="select" value={contactId} onChange={(e) => setContactId(e.target.value)}>
            <option value="">No contact</option>
            {contacts.map((c) => (
              <option key={c.id} value={c.id}>
                {c.firstName} {c.lastName}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="task-assignee">Assignee</label>
          <input id="task-assignee" className="input" value={assignee} onChange={(e) => setAssignee(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="task-due">Due</label>
          <input id="task-due" className="input" type="datetime-local" value={due} onChange={(e) => setDue(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="task-priority">Priority</label>
          <select
            id="task-priority"
            className="select"
            value={priority}
            onChange={(e) => setPriority(e.target.value as TaskPriority)}
          >
            <option value="high">High</option>
            <option value="medium">Medium</option>
            <option value="low">Low</option>
          </select>
        </div>
      </div>
      <div className="row" style={{ gap: 8, marginTop: 14 }}>
        <Avatar name={assignee} size="xs" />
        <span className="hint">The task appears in that person&apos;s list and on the contact record.</span>
      </div>
    </Modal>
  );
}
