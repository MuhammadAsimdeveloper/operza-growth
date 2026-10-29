import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Icon } from '../components/Icon';
import { Modal } from '../components/Modal';
import { Avatar, Badge, EmptyState, PageHeader, StatCard } from '../components/ui';
import { uid, useStore } from '../lib/store';
import { shortDate, timeOf, toDateTimeInput } from '../lib/format';
import { api } from '../lib/api';
import type { Task, TaskPriority } from '../lib/types';

const PRIORITY: Record<TaskPriority, { label: string; tone: 'default' | 'amber' | 'red' }> = {
  high: { label: 'High', tone: 'red' },
  medium: { label: 'Medium', tone: 'amber' },
  low: { label: 'Low', tone: 'default' },
};

type Filter = 'open' | 'done' | 'all';

export default function Tasks() {
  const { state, dispatch } = useStore();
  const [filter, setFilter] = useState<Filter>('open');
  const [query, setQuery] = useState('');
  const [adding, setAdding] = useState(false);

  useEffect(() => {
    let active = true;
    api.crm.list('tasks').then((res) => {
      if (!active || !res?.data) return;
      for (const t of res.data) {
        if (!state.tasks.some((st) => st.id === t.id)) {
          dispatch({
            type: 'task/add',
            task: {
              id: t.id,
              title: t.title || 'Follow-up Task',
              contactId: t.contactId,
              assignee: t.assignedTo || 'Current User',
              dueAt: t.dueDate || new Date(Date.now() + 86400000).toISOString(),
              priority: (t.priority === 'high' ? 'high' : t.priority === 'low' ? 'low' : 'medium') as TaskPriority,
              done: t.status === 'completed',
              createdAt: t.createdAt || new Date().toISOString(),
            },
          });
        }
      }
    }).catch(() => {});
    return () => {
      active = false;
    };
  }, [state.tasks, dispatch]);

  const now = Date.now();
  const contactName = (id?: string) => {
    const c = id ? state.contacts.find((x) => x.id === id) : undefined;
    return c ? `${c.firstName} ${c.lastName}` : null;
  };

  const tasks = useMemo(() => {
    const q = query.trim().toLowerCase();
    return state.tasks
      .filter((t) => {
        if (filter === 'open' && t.done) return false;
        if (filter === 'done' && !t.done) return false;
        if (!q) return true;
        return `${t.title} ${t.assignee} ${contactName(t.contactId) ?? ''}`.toLowerCase().includes(q);
      })
      .sort((a, b) => a.dueAt.localeCompare(b.dueAt));
    // contactName closes over state.contacts, which is already a dependency
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.tasks, state.contacts, filter, query]);

  const open = state.tasks.filter((t) => !t.done);
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
  const completed = state.tasks.filter((t) => t.done);

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
    <div className="content">
      <PageHeader
        title="Tasks"
        subtitle="Follow-ups across contacts and deals, sorted by what is due next."
        actions={
          <button className="btn btn--primary" onClick={() => setAdding(true)}>
            <Icon name="plus" size={16} /> New task
          </button>
        }
      />

      <div className="grid grid--4" style={{ marginBottom: 16 }}>
        <StatCard label="Open tasks" value={String(open.length)} icon={<Icon name="task" size={15} />} meta="across the team" />
        <StatCard label="Overdue" value={String(overdue.length)} icon={<Icon name="clock" size={15} />} meta="needs attention" />
        <StatCard label="Due today" value={String(dueToday.length)} icon={<Icon name="calendar" size={15} />} meta="before end of day" />
        <StatCard label="Completed" value={String(completed.length)} icon={<Icon name="check" size={15} />} meta="all time" />
      </div>

      <div className="card">
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

        {tasks.length === 0 ? (
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
                  <TaskRow key={t.id} task={t} />
                ))}
              </div>
            ))}
            {doneTasks.length > 0 && (
              <div>
                <div className="task-group">Done</div>
                {doneTasks.map((t) => (
                  <TaskRow key={t.id} task={t} />
                ))}
              </div>
            )}
          </>
        )}
      </div>

      {adding && <NewTask onClose={() => setAdding(false)} />}
    </div>
  );
}

function TaskRow({ task }: { task: Task }) {
  const { state, dispatch } = useStore();
  const contact = task.contactId ? state.contacts.find((c) => c.id === task.contactId) : undefined;
  const priority = PRIORITY[task.priority];

  return (
    <div className={`task${task.done ? ' is-done' : ''}`}>
      <button
        type="button"
        className="task__check"
        role="checkbox"
        aria-checked={task.done}
        aria-label={task.done ? `Reopen ${task.title}` : `Complete ${task.title}`}
        onClick={async () => {
          const nextDone = !task.done;
          try {
            await api.crm.update('tasks', task.id, { status: nextDone ? 'completed' : 'pending' });
          } catch (err) {
            console.error('Failed to toggle task in backend:', err);
          }
          dispatch({ type: 'task/toggle', id: task.id });
        }}
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
        onClick={async () => {
          try {
            await api.crm.delete('tasks', task.id);
          } catch (err) {
            console.error('Failed to delete task in backend:', err);
          }
          dispatch({ type: 'task/delete', id: task.id });
        }}
      >
        <Icon name="trash" size={15} />
      </button>
    </div>
  );
}

function NewTask({ onClose }: { onClose: () => void }) {
  const { state, dispatch } = useStore();
  const [title, setTitle] = useState('');
  const [contactId, setContactId] = useState('');
  const [assignee, setAssignee] = useState(state.team[0]?.name ?? 'Asim R.');
  const [priority, setPriority] = useState<TaskPriority>('medium');
  const [due, setDue] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    d.setHours(9, 0, 0, 0);
    return toDateTimeInput(d);
  });

  const canSave = title.trim().length > 1 && !!due;

  const save = async () => {
    if (!canSave) return;
    let newId = uid('tk');
    try {
      const res = await api.crm.create('tasks', {
        title: title.trim(),
        contactId: contactId || undefined,
        assignedTo: assignee.trim(),
        dueDate: new Date(due).toISOString(),
        priority,
        status: 'pending'
      });
      if (res?.id) newId = res.id;
    } catch (err) {
      console.error('Failed to create task in backend:', err);
    }
    dispatch({
      type: 'task/add',
      task: {
        id: newId,
        title: title.trim(),
        contactId: contactId || undefined,
        assignee,
        dueAt: new Date(due).toISOString(),
        priority,
        done: false,
        createdAt: new Date().toISOString(),
      },
    });
    onClose();
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
            Create task
          </button>
        </>
      }
    >
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
            {state.contacts.map((c) => (
              <option key={c.id} value={c.id}>
                {c.firstName} {c.lastName}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="task-assignee">Assignee</label>
          <select id="task-assignee" className="select" value={assignee} onChange={(e) => setAssignee(e.target.value)}>
            {state.team.map((m) => (
              <option key={m.id} value={m.name}>
                {m.name}
              </option>
            ))}
          </select>
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
