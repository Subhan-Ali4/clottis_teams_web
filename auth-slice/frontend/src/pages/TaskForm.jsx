import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../api.js';

const EMPTY = {
  title: '', description: '', projectId: '', sprintId: '', columnId: '', priority: 'medium',
  dueDate: '', assigneeId: '', reviewerId: '', acceptanceCriteria: '',
};

const fromTask = (t) => ({
  title: t.title, description: t.description, projectId: String(t.projectId),
  sprintId: t.sprintId ? String(t.sprintId) : '', columnId: String(t.columnId),
  priority: t.priority, dueDate: t.dueDate ?? '',
  assigneeId: t.assigneeId ? String(t.assigneeId) : '', reviewerId: t.reviewerId ? String(t.reviewerId) : '',
  acceptanceCriteria: t.acceptanceCriteria,
});

const idOrNull = (v) => (v === '' ? null : Number(v));

function validate(f) {
  const e = {};
  if (!f.title.trim()) e.title = 'Title is required';
  else if (f.title.trim().length > 200) e.title = 'Title must be 200 characters or fewer';
  if (!f.projectId) e.projectId = 'Project is required';
  if (f.description.length > 5000) e.description = 'Description must be 5000 characters or fewer';
  if (f.acceptanceCriteria.length > 5000) e.acceptanceCriteria = 'Acceptance criteria must be 5000 characters or fewer';
  if (f.assigneeId && f.assigneeId === f.reviewerId) e.reviewerId = 'Reviewer must be a different person from the assignee';
  return e;
}

export default function TaskForm() {
  const { id } = useParams();
  const editing = Boolean(id);
  const navigate = useNavigate();

  const [projects, setProjects] = useState([]);
  const [people, setPeople] = useState([]);
  const [form, setForm] = useState(EMPTY);
  const [version, setVersion] = useState(null);
  const [errors, setErrors] = useState({});
  const [formError, setFormError] = useState('');
  const [conflict, setConflict] = useState(null); // latest task from the server
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const [p, u, t] = await Promise.all([
          api.listProjects(), api.directoryUsers(), editing ? api.getTask(id) : Promise.resolve(null),
        ]);
        if (!alive) return;
        setProjects(p.projects);
        // Keep the current assignee/reviewer selectable even if they were deactivated since.
        const known = new Set(u.users.map((x) => x.id));
        const extra = t ? [t.task.assignee, t.task.reviewer]
          .filter((x) => x && !known.has(x.id)).map((x) => ({ id: x.id, name: x.name, role: 'inactive' })) : [];
        setPeople([...u.users, ...extra]);
        if (t) { setForm(fromTask(t.task)); setVersion(t.task.version); }
        else if (p.projects[0]) setForm((f) => ({ ...f, projectId: String(p.projects[0].id) }));
      } catch (e) {
        if (alive) setFormError(e.status === 404 ? 'Task not found.' : e.message);
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [id, editing]);

  const project = useMemo(() => projects.find((p) => String(p.id) === form.projectId), [projects, form.projectId]);
  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));
  const onProject = (e) => setForm((f) => ({ ...f, projectId: e.target.value, sprintId: '', columnId: '' }));

  const options = people; // active users, plus anyone already set on this task

  const onSubmit = async (e) => {
    e.preventDefault();
    setFormError(''); setConflict(null);
    const found = validate(form);
    setErrors(found);
    if (Object.keys(found).length) return;

    const body = {
      title: form.title.trim(),
      description: form.description,
      priority: form.priority,
      dueDate: form.dueDate || null,
      sprintId: idOrNull(form.sprintId),
      assigneeId: idOrNull(form.assigneeId),
      reviewerId: idOrNull(form.reviewerId),
      acceptanceCriteria: form.acceptanceCriteria,
    };
    if (form.columnId) body.columnId = Number(form.columnId);

    setBusy(true);
    try {
      let task;
      if (editing) task = (await api.updateTask(id, { ...body, version })).task;
      else task = (await api.createTask({ ...body, projectId: Number(form.projectId) })).task;
      navigate(`/tasks/${task.id}`);
    } catch (err) {
      if (err.status === 409 && err.code === 'VERSION_CONFLICT') {
        setConflict(err.current);
      } else if (err.fields) {
        setErrors(err.fields);
        setFormError(err.message);
      } else {
        setFormError(err.message);
      }
    } finally {
      setBusy(false);
    }
  };

  const loadLatest = () => {
    setForm(fromTask(conflict));
    setVersion(conflict.version);
    setConflict(null);
    setErrors({});
  };

  const fieldProps = (name) => ({
    id: name,
    'aria-invalid': errors[name] ? 'true' : undefined,
    'aria-describedby': errors[name] ? `${name}-error` : undefined,
  });
  const FieldError = ({ name }) => (errors[name]
    ? <p className="field-error" id={`${name}-error`}>{errors[name]}</p> : null);

  if (loading) return <p className="center muted">Loading…</p>;
  if (editing && version === null) {
    return (
      <div className="card">
        <p className="alert alert-error" role="alert">{formError || 'Task not found.'}</p>
        <Link to="/board">Back to the board</Link>
      </div>
    );
  }

  return (
    <form className="card" onSubmit={onSubmit} noValidate>
      <h1>{editing ? 'Edit task' : 'New task'}</h1>
      {formError && <p className="alert alert-error" role="alert">{formError}</p>}
      {conflict && (
        <div className="alert alert-error" role="alert">
          <strong>Someone else changed this task.</strong> Your changes were not saved, so nothing was overwritten.
          <div className="form-actions">
            <button type="button" className="btn" onClick={loadLatest}>Load the latest version</button>
          </div>
        </div>
      )}

      <label htmlFor="title">Title</label>
      <input {...fieldProps('title')} value={form.title} onChange={set('title')} />
      <FieldError name="title" />

      <label htmlFor="description">Description</label>
      <textarea {...fieldProps('description')} rows={4} value={form.description} onChange={set('description')} />
      <FieldError name="description" />

      <div className="grid-2">
        <div>
          <label htmlFor="projectId">Project</label>
          <select {...fieldProps('projectId')} value={form.projectId} onChange={onProject} disabled={editing}>
            {!form.projectId && <option value="">Select a project</option>}
            {projects.map((p) => <option key={p.id} value={p.id}>{p.key} · {p.name}</option>)}
          </select>
          {editing && <p className="hint">A task stays in its project.</p>}
          <FieldError name="projectId" />
        </div>
        <div>
          <label htmlFor="sprintId">Sprint</label>
          <select {...fieldProps('sprintId')} value={form.sprintId} onChange={set('sprintId')}>
            <option value="">No sprint</option>
            {project?.sprints.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
          <FieldError name="sprintId" />
        </div>
        <div>
          <label htmlFor="columnId">Board column</label>
          <select {...fieldProps('columnId')} value={form.columnId} onChange={set('columnId')}>
            {!editing && <option value="">First column</option>}
            {project?.columns.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          {editing && <p className="hint">Changing the column puts the task at the bottom of it.</p>}
          <FieldError name="columnId" />
        </div>
        <div>
          <label htmlFor="priority">Priority</label>
          <select {...fieldProps('priority')} value={form.priority} onChange={set('priority')}>
            {['low', 'medium', 'high', 'urgent'].map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
          <FieldError name="priority" />
        </div>
        <div>
          <label htmlFor="dueDate">Due date</label>
          <input {...fieldProps('dueDate')} type="date" value={form.dueDate} onChange={set('dueDate')} />
          <FieldError name="dueDate" />
        </div>
        <div />
        <div>
          <label htmlFor="assigneeId">Primary assignee</label>
          <select {...fieldProps('assigneeId')} value={form.assigneeId} onChange={set('assigneeId')}>
            <option value="">Unassigned</option>
            {options.map((u) => <option key={u.id} value={u.id}>{u.name} ({u.role})</option>)}
          </select>
          <FieldError name="assigneeId" />
        </div>
        <div>
          <label htmlFor="reviewerId">Reviewer</label>
          <select {...fieldProps('reviewerId')} value={form.reviewerId} onChange={set('reviewerId')}>
            <option value="">No reviewer</option>
            {options.map((u) => <option key={u.id} value={u.id}>{u.name} ({u.role})</option>)}
          </select>
          <FieldError name="reviewerId" />
        </div>
      </div>

      <label htmlFor="acceptanceCriteria">Acceptance criteria</label>
      <textarea {...fieldProps('acceptanceCriteria')} rows={4} value={form.acceptanceCriteria}
        onChange={set('acceptanceCriteria')} />
      <FieldError name="acceptanceCriteria" />

      <div className="form-actions">
        <button type="submit" className="btn btn-primary btn-inline" disabled={busy}>
          {busy ? 'Saving…' : editing ? 'Save changes' : 'Create task'}
        </button>
        <Link to={editing ? `/tasks/${id}` : '/board'} className="btn btn-ghost">Cancel</Link>
      </div>
    </form>
  );
}
