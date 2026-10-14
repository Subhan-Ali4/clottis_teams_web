import { Link } from 'react-router-dom';

export default function TaskCard({ task, columns, dragging, onDragStart, onDragEnd, onMove }) {
  return (
    <article
      className={`task-card${dragging ? ' dragging' : ''}`}
      draggable
      data-task-id={task.id}
      aria-label={`Task ${task.title}`}
      onDragStart={(e) => {
        e.dataTransfer?.setData?.('text/plain', String(task.id));
        if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
        onDragStart(task);
      }}
      onDragEnd={onDragEnd}
    >
      <div className="task-card-top">
        <span className="task-key">{task.project.key}-{task.id}</span>
        <span className={`badge prio prio-${task.priority}`}>{task.priority}</span>
      </div>
      <Link to={`/tasks/${task.id}`} className="task-title" draggable={false}>{task.title}</Link>
      <div className="task-meta">
        {task.dueDate && <span>Due {task.dueDate}</span>}
        {task.assignee && <span>Assignee: {task.assignee.name}</span>}
        {task.reviewer && <span>Reviewer: {task.reviewer.name}</span>}
        {task.sprint && <span>{task.sprint.name}</span>}
      </div>
      {/* Keyboard- and touch-friendly alternative to dragging. */}
      <select
        className="move-select"
        aria-label={`Move ${task.title} to column`}
        value={task.columnId}
        onChange={(e) => onMove(task, Number(e.target.value))}
      >
        {columns.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
      </select>
    </article>
  );
}
