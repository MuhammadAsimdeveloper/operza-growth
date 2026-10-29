import { useEffect, useState } from 'react';
import { Icon } from '../components/Icon';
import { Modal } from '../components/Modal';
import { Avatar, Badge, EmptyState, PageHeader, StatCard, Switch } from '../components/ui';
import { currency, num, shortDate } from '../lib/format';
import { uid, useStore } from '../lib/store';
import { api } from '../lib/api';
import type { Course, CourseKind, Enrollment } from '../lib/types';

type Filter = 'all' | 'published' | 'draft';

function daysSince(iso: string): number {
  return Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
}

function unlockedLessons(course: Course, enrollment: Enrollment): number {
  const elapsed = daysSince(enrollment.startedAt);
  return course.curriculum.filter((l) => l.dripDays <= elapsed).length;
}

export default function Memberships() {
  const { state, dispatch } = useStore();
  const { courses, enrollments } = state;
  const [filter, setFilter] = useState<Filter>('all');
  const [detailId, setDetailId] = useState<string | null>(null);
  const [membersOpen, setMembersOpen] = useState(false);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    api.crm.list<Course>('courses').then((res) => {
      if (res.data && res.data.length > 0) {
        for (const c of res.data) {
          if (!courses.some((x) => x.id === c.id)) {
            dispatch({ type: 'course/add', course: c });
          }
        }
      }
    }).catch(() => { /* dev fallback */ });
  }, []);

  const totalEnrollments = courses.reduce((s, c) => s + c.enrollments, 0);
  const revenue = courses.reduce((s, c) => {
    const seats = c.kind === 'community' ? c.enrollments * 12 : c.enrollments;
    return s + seats * c.price;
  }, 0);
  const completion = enrollments.length
    ? enrollments.reduce((s, e) => s + e.progress, 0) / enrollments.length
    : 0;
  const dripped = courses.filter((c) => c.curriculum.some((l) => l.dripDays > 0));

  const visible = courses.filter((c) =>
    filter === 'all' ? true : filter === 'published' ? c.published : !c.published,
  );

  const contactOf = (id: string) => state.contacts.find((x) => x.id === id);
  const contactName = (id: string) => {
    const c = contactOf(id);
    return c ? `${c.firstName} ${c.lastName}` : 'Unknown contact';
  };

  const detail = courses.find((c) => c.id === detailId) ?? null;

  return (
    <div className="content">
      <PageHeader
        title="Memberships"
        subtitle="Courses, communities and the people learning inside them."
        actions={
          <>
            <button className="btn" onClick={() => setMembersOpen(true)}>
              <Icon name="users" size={15} /> Members
            </button>
            <button className="btn btn--primary" onClick={() => setCreating(true)}>
              <Icon name="plus" size={15} /> New offer
            </button>
          </>
        }
      />

      <div className="grid grid--4" style={{ marginBottom: 16 }}>
        <StatCard
          label="Active members"
          value={num(totalEnrollments)}
          icon={<Icon name="users" size={15} />}
          trend={{ direction: 'up', value: '9.2%' }}
          meta="vs. last month"
        />
        <StatCard
          label="Offers live"
          value={`${courses.filter((c) => c.published).length}/${courses.length}`}
          icon={<Icon name="book" size={15} />}
          meta="published"
        />
        <StatCard
          label="Avg. completion"
          value={`${Math.round(completion)}%`}
          icon={<Icon name="chart" size={15} />}
          meta="across enrollments"
        />
        <StatCard
          label="Course revenue"
          value={currency(revenue)}
          icon={<Icon name="dollar" size={15} />}
          meta="lifetime"
        />
      </div>

      <div className="row row--between" style={{ marginBottom: 12 }}>
        <div className="tabs" style={{ margin: 0 }}>
          {(['all', 'published', 'draft'] as Filter[]).map((f) => (
            <button
              key={f}
              type="button"
              className={`tab${filter === f ? ' is-active' : ''}`}
              onClick={() => setFilter(f)}
            >
              {f === 'all' ? 'All offers' : f === 'published' ? 'Published' : 'Drafts'}
            </button>
          ))}
        </div>
        <span className="hint">
          {dripped.length} offer{dripped.length === 1 ? '' : 's'} release lessons on a schedule
        </span>
      </div>

      {visible.length === 0 ? (
        <EmptyState
          icon={<Icon name="book" size={22} />}
          title="No offers in this view"
          text="Publish an offer or switch the filter."
        />
      ) : (
        <div className="grid grid--3" style={{ marginBottom: 16 }}>
          {visible.map((course) => {
            const seats = enrollments.filter((e) => e.courseId === course.id);
            const avgProgress = seats.length
              ? Math.round(seats.reduce((s, e) => s + e.progress, 0) / seats.length)
              : 0;
            const lastDrip = course.curriculum.reduce((max, l) => Math.max(max, l.dripDays), 0);
            return (
              <div key={course.id} className="card course">
                <div className="course__cover">
                  <Icon name={course.kind === 'community' ? 'users' : 'book'} size={26} />
                </div>
                <div className="course__body">
                  <div className="row row--between" style={{ gap: 8 }}>
                    <strong style={{ fontSize: 13.5 }}>{course.title}</strong>
                    <Badge tone={course.kind === 'community' ? 'violet' : 'blue'}>
                      {course.kind === 'community' ? 'Community' : 'Course'}
                    </Badge>
                  </div>
                  <div className="cell-sub" style={{ marginTop: 2 }}>
                    {course.kind === 'community'
                      ? 'Monthly membership'
                      : `${course.curriculum.length} lessons${lastDrip > 0 ? ` · ${lastDrip}-day drip` : ''}`}
                    {' · '}
                    {currency(course.price)}
                    {course.kind === 'community' ? '/mo' : ''}
                  </div>

                  <div style={{ marginTop: 12 }}>
                    <div className="row row--between" style={{ marginBottom: 4 }}>
                      <span className="hint">Avg. progress</span>
                      <span className="cell-sub">{avgProgress}%</span>
                    </div>
                    <div className="meter">
                      <div className="meter__fill" style={{ width: `${avgProgress}%` }} />
                    </div>
                  </div>

                  <div className="row row--between" style={{ marginTop: 12 }}>
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 650 }}>{num(course.enrollments)}</div>
                      <div className="cell-sub">enrolled</div>
                    </div>
                    <span className="row" style={{ gap: 8 }}>
                      <button className="btn btn--sm" onClick={() => setDetailId(course.id)}>
                        Lessons
                      </button>
                      <Switch
                        on={course.published}
                        label={`Publish ${course.title}`}
                        onChange={async () => {
                          dispatch({ type: 'course/toggle', id: course.id });
                          try {
                            await api.courses.publish(course.id, !course.published);
                          } catch { /* dev fallback */ }
                        }}
                      />
                    </span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <div className="card">
        <div className="card__head">
          <div>
            <div className="card__title">Recent enrollments</div>
            <div className="card__sub">{enrollments.length} active seats</div>
          </div>
          <div className="card__actions">
            <button className="btn btn--sm" onClick={() => setMembersOpen(true)}>
              View all
            </button>
          </div>
        </div>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Member</th>
                <th>Offer</th>
                <th>Started</th>
                <th>Unlocked</th>
                <th style={{ width: 200 }}>Progress</th>
              </tr>
            </thead>
            <tbody>
              {enrollments.map((en) => {
                const course = courses.find((c) => c.id === en.courseId);
                const unlocked = course ? unlockedLessons(course, en) : 0;
                return (
                  <tr key={en.id}>
                    <td>
                      <span className="person">
                        <Avatar name={contactName(en.contactId)} />
                        <span className="person__text">
                          <span className="person__name">{contactName(en.contactId)}</span>
                          <span className="person__sub">{contactOf(en.contactId)?.email ?? ''}</span>
                        </span>
                      </span>
                    </td>
                    <td>{course?.title ?? '—'}</td>
                    <td className="cell-sub">{shortDate(en.startedAt)}</td>
                    <td className="cell-sub">
                      {course && course.curriculum.length > 0
                        ? `${unlocked}/${course.curriculum.length}`
                        : '—'}
                    </td>
                    <td>
                      <div className="row" style={{ gap: 8 }}>
                        <div className="meter" style={{ flex: 1 }}>
                          <div
                            className="meter__fill"
                            style={{
                              width: `${en.progress}%`,
                              background: en.progress === 100 ? 'var(--green)' : undefined,
                            }}
                          />
                        </div>
                        <span className="cell-sub" style={{ width: 34, textAlign: 'right' }}>
                          {en.progress}%
                        </span>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {detail && <CourseDetailModal course={detail} onClose={() => setDetailId(null)} />}

      {membersOpen && (
        <Modal title="Members" wide onClose={() => setMembersOpen(false)} footer={<button className="btn" onClick={() => setMembersOpen(false)}>Done</button>}>
          {enrollments.length === 0 ? (
            <EmptyState icon={<Icon name="users" size={20} />} title="No members yet" />
          ) : (
            <div>
              {[...enrollments]
                .sort((a, b) => b.startedAt.localeCompare(a.startedAt))
                .map((en) => {
                  const course = courses.find((c) => c.id === en.courseId);
                  const unlocked = course ? unlockedLessons(course, en) : 0;
                  return (
                    <div className="list-row" key={en.id}>
                      <Avatar name={contactName(en.contactId)} />
                      <div style={{ minWidth: 0, flex: 1 }}>
                        <div style={{ fontSize: 13, fontWeight: 550 }}>{contactName(en.contactId)}</div>
                        <div className="cell-sub">{course?.title ?? 'Unknown offer'}</div>
                      </div>
                      <div style={{ textAlign: 'right' }}>
                        <div className="cell-sub">{en.progress}% complete</div>
                        <div className="cell-sub">
                          {course && course.curriculum.length > 0
                            ? `${unlocked} of ${course.curriculum.length} unlocked`
                            : 'No drip schedule'}
                        </div>
                      </div>
                    </div>
                  );
                })}
            </div>
          )}
        </Modal>
      )}

      {creating && <NewOfferModal onClose={() => setCreating(false)} />}
    </div>
  );
}

function CourseDetailModal({ course, onClose }: { course: Course; onClose: () => void }) {
  const { dispatch } = useStore();
  const [title, setTitle] = useState('');
  const [minutes, setMinutes] = useState('15');
  const [dripDays, setDripDays] = useState('0');

  const duration = Number(minutes);
  const drip = Number(dripDays);
  const canAdd =
    title.trim().length > 0 &&
    Number.isFinite(duration) &&
    duration > 0 &&
    Number.isFinite(drip) &&
    drip >= 0;

  const addLesson = async () => {
    if (!canAdd) return;
    const lesson = { id: uid('ls'), title: title.trim(), durationMin: duration, dripDays: drip };
    dispatch({
      type: 'lesson/add',
      courseId: course.id,
      lesson,
    });
    try {
      const res = await api.courses.addLesson(course.id, {
        title: lesson.title,
        durationMin: lesson.durationMin,
        dripDays: lesson.dripDays,
      });
      if (res?.lesson?.id) {
        lesson.id = res.lesson.id;
      }
    } catch { /* dev fallback */ }
    setTitle('');
    setMinutes('15');
    setDripDays('0');
  };

  const lastDrip = course.curriculum.reduce((max, l) => Math.max(max, l.dripDays), 0);

  return (
    <Modal
      title={`${course.title} curriculum`}
      wide
      onClose={onClose}
      footer={
        <button className="btn" onClick={onClose}>
          Done
        </button>
      }
    >
      <div className="row row--between" style={{ gap: 12 }}>
        <div>
          <div className="cell-sub">
            {course.kind === 'community' ? 'Community' : 'Course'} · {currency(course.price)}
            {course.kind === 'community' ? '/mo' : ''} · {course.curriculum.length} lessons
          </div>
          <div className="hint">
            {lastDrip > 0
              ? `New members unlock every lesson within ${lastDrip} days of enrolling.`
              : 'All lessons unlock immediately after enrolling.'}
          </div>
        </div>
        <div className="row" style={{ gap: 8 }}>
          <span className="hint">{course.published ? 'Published' : 'Draft'}</span>
          <Switch
            on={course.published}
            label={`Publish ${course.title}`}
            onChange={async () => {
              dispatch({ type: 'course/toggle', id: course.id });
              try {
                await api.courses.publish(course.id, !course.published);
              } catch { /* dev fallback */ }
            }}
          />
        </div>
      </div>

      <div className="divider" />

      {course.curriculum.length === 0 ? (
        <EmptyState icon={<Icon name="book" size={20} />} title="No lessons yet" text="Add the first lesson below." />
      ) : (
        <div>
          {course.curriculum.map((lesson, index) => (
            <div className="list-row" key={lesson.id}>
              <span className="lesson-index">{index + 1}</span>
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ fontSize: 13, fontWeight: 550 }}>{lesson.title}</div>
                <div className="cell-sub">
                  {lesson.durationMin} min ·{' '}
                  {lesson.dripDays > 0 ? `Unlocks day ${lesson.dripDays}` : 'Instant access'}
                </div>
              </div>
              <input
                className="input"
                type="number"
                min="0"
                aria-label={`Drip days for ${lesson.title}`}
                title="Days after enrollment before this lesson unlocks"
                value={lesson.dripDays}
                onChange={async (e) => {
                  const newDrip = Math.max(0, Number(e.target.value) || 0);
                  dispatch({
                    type: 'lesson/update',
                    courseId: course.id,
                    id: lesson.id,
                    patch: { dripDays: newDrip },
                  });
                  const updated = course.curriculum.map((l) =>
                    l.id === lesson.id ? { ...l, dripDays: newDrip } : l
                  );
                  try {
                    await api.courses.updateCurriculum(course.id, updated);
                  } catch { /* dev fallback */ }
                }}
                style={{ width: 66 }}
              />
              <button
                className="icon-btn"
                aria-label={`Remove ${lesson.title}`}
                onClick={async () => {
                  dispatch({ type: 'lesson/delete', courseId: course.id, id: lesson.id });
                  const updated = course.curriculum.filter((l) => l.id !== lesson.id);
                  try {
                    await api.courses.updateCurriculum(course.id, updated);
                  } catch { /* dev fallback */ }
                }}
              >
                <Icon name="trash" size={15} />
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="divider" />

      <div className="grid grid--3" style={{ alignItems: 'end' }}>
        <div className="field" style={{ marginBottom: 0 }}>
          <label htmlFor="lesson-title">New lesson</label>
          <input
            id="lesson-title"
            className="input"
            placeholder="Lesson title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
        </div>
        <div className="field" style={{ marginBottom: 0 }}>
          <label htmlFor="lesson-minutes">Minutes</label>
          <input
            id="lesson-minutes"
            className="input"
            type="number"
            min="1"
            value={minutes}
            onChange={(e) => setMinutes(e.target.value)}
          />
        </div>
        <div className="field" style={{ marginBottom: 0 }}>
          <label htmlFor="lesson-drip">Drip day</label>
          <div className="row" style={{ gap: 6 }}>
            <input
              id="lesson-drip"
              className="input"
              type="number"
              min="0"
              value={dripDays}
              onChange={(e) => setDripDays(e.target.value)}
            />
            <button className="btn btn--primary" disabled={!canAdd} onClick={addLesson}>
              Add
            </button>
          </div>
        </div>
      </div>
      <div className="hint" style={{ marginTop: 8 }}>
        Drip day 0 unlocks on enrollment. Day 7 unlocks one week after the member starts.
      </div>
    </Modal>
  );
}

function NewOfferModal({ onClose }: { onClose: () => void }) {
  const { dispatch } = useStore();
  const [title, setTitle] = useState('');
  const [kind, setKind] = useState<CourseKind>('course');
  const [price, setPrice] = useState('99');
  const [published, setPublished] = useState(false);

  const amount = Number(price);
  const canSave = title.trim().length > 0 && Number.isFinite(amount) && amount >= 0;

  const save = async () => {
    if (!canSave) return;
    const newCourse: Course = {
      id: uid('co'),
      title: title.trim(),
      kind,
      curriculum: [],
      enrollments: 0,
      price: amount,
      published,
    };
    try {
      await api.crm.create('courses', {
        name: newCourse.title,
        price: newCourse.price,
        kind: newCourse.kind,
        published: newCourse.published,
        members: 0,
        status: newCourse.published ? 'published' : 'draft',
      });
    } catch { /* dev fallback */ }
    dispatch({
      type: 'course/add',
      course: newCourse,
    });
    onClose();
  };

  return (
    <Modal
      title="New offer"
      onClose={onClose}
      footer={
        <>
          <button className="btn" type="button" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn--primary" type="button" disabled={!canSave} onClick={save}>
            Create offer
          </button>
        </>
      }
    >
      <div className="grid grid--2">
        <div className="field">
          <label htmlFor="offer-title">Title</label>
          <input
            id="offer-title"
            className="input"
            autoFocus
            placeholder="Retention Accelerator"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor="offer-kind">Type</label>
          <select
            id="offer-kind"
            className="select"
            value={kind}
            onChange={(e) => setKind(e.target.value as CourseKind)}
          >
            <option value="course">Course</option>
            <option value="community">Community</option>
          </select>
        </div>
        <div className="field">
          <label htmlFor="offer-price">Price (USD{kind === 'community' ? ' / month' : ''})</label>
          <input
            id="offer-price"
            className="input"
            type="number"
            min="0"
            value={price}
            onChange={(e) => setPrice(e.target.value)}
          />
        </div>
        <div className="field">
          <label>Visibility</label>
          <div className="row row--between">
            <span className="hint">{published ? 'Published to members' : 'Draft — hidden from members'}</span>
            <Switch on={published} label="Publish offer" onChange={() => setPublished((v) => !v)} />
          </div>
        </div>
      </div>
      <div className="hint">Lessons are added from the offer's curriculum after it is created.</div>
    </Modal>
  );
}
