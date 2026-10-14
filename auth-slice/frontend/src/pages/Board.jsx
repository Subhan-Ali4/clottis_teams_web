import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';
import TaskCard from '../components/TaskCard.jsx';

// Cards of one column in their stored order.
const inColumn = (tasks, columnId) =>
  tasks.filter((t) => t.columnId === columnId).sort((a, b) => a.position - b.position || a.id - b.id);

// Applies a move to a local copy so the card jumps immediately; the server answer
// replaces this when the board reloads.
function applyMove(tasks, task, columnId, index) {
  const fromColumn = inColumn(tasks, task.columnId).filter((t) => t.id !== task.id);
  const toColumn = columnId === task.columnId
    ? fromColumn
    : inColumn(tasks, columnId);
  const target = [...toColumn];
  target.splice(index, 0, { ...task, columnId });
  const renumber = (list, cid) => list.map((t, i) => ({ ...t, columnId: cid, position: i }));
  const touched = new Set([task.columnId, columnId]);
  const rest = tasks.filter((t) => !touched.has(t.columnId));
  return columnId === task.columnId
    ? [...rest, ...renumber(target, columnId)]
    : [...rest, ...renumber(fromColumn, task.columnId), ...renumber(target, columnId)];
}

export default function Board() {
  const [projects, setProjects] = useState(null);
  const [projectId, setProjectId] = useState(null);
  const [tasks, setTasks] = useState([]);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [dragged, setDragged] = useState(null);
  const [hover, setHover] = useState(null); // { columnId, index } = where the card would land
  const columnEls = useRef({});

  useEffect(() => {
    let alive = true;
    api.listProjects()
      .then((r) => {
        if (!alive) return;
        setProjects(r.projects);
        setProjectId(r.projects[0]?.id ?? null);
      })
      .catch((e) => alive && (setError(e.message), setProjects([])));
    return () => { alive = false; };
  }, []);

  const loadTasks = useCallback(async (pid) => {
    if (!pid) return;
    try {
      const r = await api.listTasks({ projectId: pid });
      setTasks(r.tasks);
    } catch (e) {
      setError(e.message);
    }
  }, []);
  useEffect(() => { loadTasks(projectId); }, [projectId, loadTasks]);

  const project = projects?.find((p) => p.id === projectId);

  async function performMove(task, columnId, index) {
    if (columnId === task.columnId && index === task.position) return;
    setError(''); setNotice('');
    setTasks((prev) => applyMove(prev, task, columnId, index));
    try {
      await api.moveTask(task.id, { columnId, position: index, version: task.version });
    } catch (e) {
      if (e.status === 409 && e.code === 'VERSION_CONFLICT') {
        setNotice('This card was changed by someone else, so the move was not saved. The board has been refreshed.');
      } else {
        setError(e.message);
      }
    } finally {
      await loadTasks(projectId); // always show what the server really has
    }
  }

  // Where would a card dropped at this height land? Count the other cards above the cursor.
  function indexAt(columnId, clientY) {
    const el = columnEls.current[columnId];
    if (!el) return 0;
    let index = 0;
    el.querySelectorAll('[data-task-id]').forEach((card) => {
      if (Number(card.dataset.taskId) === dragged?.id) return;
      const r = card.getBoundingClientRect();
      if (r.top + r.height / 2 < clientY) index += 1;
    });
    return index;
  }

  const onDragOver = (columnId) => (e) => {
    if (!dragged) return;
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
    const index = indexAt(columnId, e.clientY);
    setHover((h) => (h?.columnId === columnId && h.index === index ? h : { columnId, index }));
  };

  const onDrop = (columnId) => (e) => {
    if (!dragged) return;
    e.preventDefault();
    const index = indexAt(columnId, e.clientY);
    const task = dragged;
    setDragged(null); setHover(null);
    performMove(task, columnId, index);
  };

  if (projects === null) return <p className="center muted">Loading…</p>;
  if (!projects.length) {
    return <div className="card"><h1>Board</h1><p className="muted">There are no projects yet.</p></div>;
  }

  return (
    <>
      <div className="board-head">
        <h1>Board</h1>
        <div className="board-tools">
          <label htmlFor="project" className="sr-only">Project</label>
          <select id="project" value={projectId ?? ''} onChange={(e) => setProjectId(Number(e.target.value))}>
            {projects.map((p) => <option key={p.id} value={p.id}>{p.key} · {p.name}</option>)}
          </select>
          <Link to="/tasks/new" className="btn btn-primary btn-inline">New task</Link>
        </div>
      </div>

      {error && <p className="alert alert-error" role="alert">{error}</p>}
      {notice && <p className="alert alert-info" role="status">{notice}</p>}

      <div className="board" aria-label="Kanban board">
        {project.columns.map((col) => {
          const cards = inColumn(tasks, col.id);
          const over = hover?.columnId === col.id;
          let seen = 0; // cards before this one, not counting the card being dragged
          const nodes = cards.map((t) => {
            const isDragged = dragged?.id === t.id;
            const lineBefore = over && !isDragged && hover.index === seen;
            if (!isDragged) seen += 1;
            return (
              <div key={t.id}>
                {lineBefore && <div className="drop-line" />}
                <TaskCard
                  task={t}
                  columns={project.columns}
                  dragging={isDragged}
                  onDragStart={setDragged}
                  onDragEnd={() => { setDragged(null); setHover(null); }}
                  onMove={(task, cid) => performMove(task, cid, inColumn(tasks, cid).filter((x) => x.id !== task.id).length)}
                />
              </div>
            );
          });
          return (
            <section
              key={col.id}
              className={`column${over ? ' column-over' : ''}`}
              aria-label={col.name}
              onDragOver={onDragOver(col.id)}
              onDrop={onDrop(col.id)}
              onDragLeave={(e) => {
                if (!e.currentTarget.contains(e.relatedTarget)) setHover((h) => (h?.columnId === col.id ? null : h));
              }}
            >
              <h2 className="column-title">{col.name} <span className="count">{cards.length}</span></h2>
              <div className="column-body" ref={(el) => { columnEls.current[col.id] = el; }}>
                {nodes}
                {over && hover.index >= seen && <div className="drop-line" />}
                {!cards.length && <p className="muted empty">No tasks</p>}
              </div>
            </section>
          );
        })}
      </div>
    </>
  );
}
