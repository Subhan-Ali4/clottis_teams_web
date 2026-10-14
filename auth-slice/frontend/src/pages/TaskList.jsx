import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';

export default function TaskList() {
  const [tasks, setTasks] = useState(null);
  const [projects, setProjects] = useState([]);
  const [projectId, setProjectId] = useState('');
  const [priority, setPriority] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    api.listProjects().then((r) => setProjects(r.projects)).catch((e) => setError(e.message));
  }, []);

  useEffect(() => {
    let alive = true;
    setTasks(null);
    api.listTasks({ projectId, priority })
      .then((r) => alive && (setTasks(r.tasks), setError('')))
      .catch((e) => alive && (setError(e.message), setTasks([])));
    return () => { alive = false; };
  }, [projectId, priority]);

  return (
    <section className="card">
      <div className="board-head">
        <h1>Tasks</h1>
        <div className="board-tools">
          <label htmlFor="f-project" className="sr-only">Filter by project</label>
          <select id="f-project" value={projectId} onChange={(e) => setProjectId(e.target.value)}>
            <option value="">All projects</option>
            {projects.map((p) => <option key={p.id} value={p.id}>{p.key} · {p.name}</option>)}
          </select>
          <label htmlFor="f-priority" className="sr-only">Filter by priority</label>
          <select id="f-priority" value={priority} onChange={(e) => setPriority(e.target.value)}>
            <option value="">All priorities</option>
            {['low', 'medium', 'high', 'urgent'].map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
          <Link to="/tasks/new" className="btn btn-primary btn-inline">New task</Link>
        </div>
      </div>

      {error && <p className="alert alert-error" role="alert">{error}</p>}
      {tasks === null && <p className="muted">Loading…</p>}
      {tasks && !tasks.length && !error && <p className="muted">No tasks match.</p>}
      {tasks && tasks.length > 0 && (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Task</th><th>Project</th><th>Sprint</th><th>Column</th>
                <th>Priority</th><th>Due</th><th>Assignee</th><th>Reviewer</th>
              </tr>
            </thead>
            <tbody>
              {tasks.map((t) => (
                <tr key={t.id}>
                  <td><Link to={`/tasks/${t.id}`}>{t.title}</Link></td>
                  <td>{t.project.key}</td>
                  <td>{t.sprint?.name ?? '—'}</td>
                  <td>{t.column.name}</td>
                  <td><span className={`badge prio prio-${t.priority}`}>{t.priority}</span></td>
                  <td>{t.dueDate ?? '—'}</td>
                  <td>{t.assignee?.name ?? '—'}</td>
                  <td>{t.reviewer?.name ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
