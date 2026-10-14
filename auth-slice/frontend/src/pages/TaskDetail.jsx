import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../api.js';

const FIELD_LABEL = {
  title: 'Title', description: 'Description', priority: 'Priority', dueDate: 'Due date',
  acceptanceCriteria: 'Acceptance criteria', sprintId: 'Sprint', assigneeId: 'Assignee', reviewerId: 'Reviewer',
};
const show = (v) => (v === null || v === undefined || v === '' ? 'none' : String(v));

function describe(a) {
  if (a.type === 'created') return `created this task in ${a.toColumn?.name ?? 'a column'}`;
  if (a.type === 'moved') {
    return a.fromColumn?.id === a.toColumn?.id
      ? `reordered it within ${a.toColumn?.name}`
      : `moved it from ${a.fromColumn?.name} to ${a.toColumn?.name}`;
  }
  const changes = a.details?.changes ?? {};
  const parts = Object.entries(changes).map(
    ([k, c]) => `${FIELD_LABEL[k] ?? k}: ${show(c.from)} → ${show(c.to)}`);
  return `updated ${parts.join('; ') || 'the task'}`;
}

export default function TaskDetail() {
  const { id } = useParams();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let alive = true;
    setData(null); setError('');
    api.getTask(id)
      .then((r) => alive && setData(r))
      .catch((e) => alive && setError(e.status === 404 ? 'Task not found.' : e.message));
    return () => { alive = false; };
  }, [id]);

  if (error) {
    return (
      <div className="card">
        <p className="alert alert-error" role="alert">{error}</p>
        <Link to="/board">Back to the board</Link>
      </div>
    );
  }
  if (!data) return <p className="center muted">Loading…</p>;

  const { task: t, activity } = data;
  return (
    <>
      <section className="card">
        <p className="muted task-key">{t.project.key}-{t.id} · {t.project.name}</p>
        <h1>{t.title}</h1>
        <dl className="facts">
          <dt>Status</dt><dd>{t.column.name}</dd>
          <dt>Priority</dt><dd><span className={`badge prio prio-${t.priority}`}>{t.priority}</span></dd>
          <dt>Sprint</dt><dd>{t.sprint?.name ?? 'No sprint'}</dd>
          <dt>Due date</dt><dd>{t.dueDate ?? 'Not set'}</dd>
          <dt>Assignee</dt><dd>{t.assignee?.name ?? 'Unassigned'}</dd>
          <dt>Reviewer</dt><dd>{t.reviewer?.name ?? 'No reviewer'}</dd>
          <dt>Created by</dt><dd>{t.createdBy?.name}</dd>
        </dl>

        <h2 className="section-title">Description</h2>
        <p className="prewrap">{t.description || <span className="muted">No description.</span>}</p>

        <h2 className="section-title">Acceptance criteria</h2>
        <p className="prewrap">{t.acceptanceCriteria || <span className="muted">None written yet.</span>}</p>

        <div className="form-actions">
          <Link to={`/tasks/${t.id}/edit`} className="btn">Edit task</Link>
          <Link to="/board" className="btn btn-ghost">Back to board</Link>
        </div>
      </section>

      <section className="card">
        <h2>Activity</h2>
        <ul className="activity">
          {activity.map((a) => (
            <li key={a.id}>
              <strong>{a.actor.name}</strong> {describe(a)}
              <span className="muted"> · {a.createdAt}</span>
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}
