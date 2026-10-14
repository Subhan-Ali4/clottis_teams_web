import { createEvent, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../api.js', () => {
  class ApiError extends Error {
    constructor(status, message, data = {}) {
      super(message);
      this.status = status;
      this.fields = data.fields || null;
      this.code = data.code || null;
      this.current = data.current || null;
    }
  }
  return {
    ApiError,
    setUnauthorizedHandler: vi.fn(),
    api: {
      me: vi.fn(), login: vi.fn(), logout: vi.fn(), changePassword: vi.fn(),
      listUsers: vi.fn(), createUser: vi.fn(), resetPassword: vi.fn(), setActive: vi.fn(),
      listProjects: vi.fn(), directoryUsers: vi.fn(), listTasks: vi.fn(), getTask: vi.fn(),
      createTask: vi.fn(), updateTask: vi.fn(), moveTask: vi.fn(),
    },
  };
});

import { api, ApiError } from '../api.js';
import { AuthProvider } from '../AuthContext.jsx';
import App from '../App.jsx';

const PROJECT = {
  id: 1, key: 'WEB', name: 'Web Platform',
  columns: [{ id: 1, name: 'To Do', position: 0 }, { id: 2, name: 'Doing', position: 1 }, { id: 3, name: 'Done', position: 2 }],
  sprints: [{ id: 5, name: 'Sprint 1' }],
};
const PEOPLE = [
  { id: 20, name: 'Aisha Khan', role: 'member' },
  { id: 21, name: 'Bilal Ahmed', role: 'member' },
];

const task = (id, title, columnId, position, over = {}) => ({
  id, title, description: '', projectId: 1, project: { id: 1, key: 'WEB', name: 'Web Platform' },
  sprintId: null, sprint: null, columnId, column: { id: columnId, name: PROJECT.columns[columnId - 1].name },
  position, priority: 'medium', dueDate: null, assigneeId: null, assignee: null, reviewerId: null,
  reviewer: null, acceptanceCriteria: '', version: 1, createdBy: { id: 10, name: 'Test Person' },
  createdAt: '2026-10-13 10:00:00', updatedAt: '2026-10-13 10:00:00', ...over,
});

// A tiny fake server so the board can reload after a move.
let server;
function serve(tasks) {
  server = tasks.map((t) => ({ ...t }));
  api.listTasks.mockImplementation(async () => ({ tasks: server.map((t) => ({ ...t })) }));
}

const signedIn = (role = 'member') =>
  api.me.mockResolvedValue({ user: { id: 10, name: 'Test Person', email: 't@example.com', role, isActive: true } });

function renderAt(path) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <AuthProvider><App /></AuthProvider>
    </MemoryRouter>,
  );
}

const dt = () => ({ dataTransfer: { setData: vi.fn(), effectAllowed: '', dropEffect: '' } });
// jsdom has no DragEvent, so the cursor height has to be attached to the event by hand.
function fireDrag(type, el, clientY) {
  const ev = createEvent[type](el, dt());
  Object.defineProperty(ev, 'clientY', { value: clientY });
  fireEvent(el, ev);
}
// clientY 1000 = below every card (drop at the bottom), 0 = above every card (drop at the top).
async function dragTo(cardName, columnName, clientY) {
  const card = await screen.findByRole('article', { name: `Task ${cardName}` });
  const column = screen.getByRole('region', { name: columnName });
  fireEvent.dragStart(card, dt());
  fireDrag('dragOver', column, clientY);
  fireDrag('drop', column, clientY);
}
const titlesIn = (columnName) =>
  within(screen.getByRole('region', { name: columnName })).queryAllByRole('article').map((a) =>
    a.getAttribute('aria-label').replace('Task ', ''));

beforeEach(() => {
  Object.values(api).forEach((fn) => fn.mockReset());
  api.listProjects.mockResolvedValue({ projects: [PROJECT] });
  api.directoryUsers.mockResolvedValue({ users: PEOPLE });
  signedIn();
});

describe('access', () => {
  it('sends a signed-out visitor from the board to the login page', async () => {
    api.me.mockRejectedValue(new ApiError(401, 'Authentication required'));
    renderAt('/board');
    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeInTheDocument();
    expect(api.listTasks).not.toHaveBeenCalled();
  });

  it('lets a Member open the board and shows Board and Tasks in the menu', async () => {
    serve([task(1, 'Alpha', 1, 0)]);
    renderAt('/board');
    expect(await screen.findByRole('article', { name: 'Task Alpha' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Board' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Tasks' })).toBeInTheDocument();
  });
});

describe('Kanban board', () => {
  it('shows cards in the stored order inside their columns', async () => {
    // The API answers out of order; positions decide.
    serve([task(3, 'Third', 1, 2), task(1, 'First', 1, 0), task(2, 'Second', 1, 1), task(4, 'Working', 2, 0)]);
    renderAt('/board');
    await screen.findByRole('article', { name: 'Task First' });
    expect(titlesIn('To Do')).toEqual(['First', 'Second', 'Third']);
    expect(titlesIn('Doing')).toEqual(['Working']);
    expect(titlesIn('Done')).toEqual([]);
  });

  it('shows the task details on the card (priority, due date, assignee)', async () => {
    serve([task(1, 'Alpha', 1, 0, { priority: 'urgent', dueDate: '2026-10-20', assignee: { id: 20, name: 'Aisha Khan' }, assigneeId: 20 })]);
    renderAt('/board');
    const card = await screen.findByRole('article', { name: 'Task Alpha' });
    expect(within(card).getByText('urgent')).toBeInTheDocument();
    expect(within(card).getByText('Due 2026-10-20')).toBeInTheDocument();
    expect(within(card).getByText('Assignee: Aisha Khan')).toBeInTheDocument();
  });

  it('dragging a card to the bottom of another column saves the move with its version', async () => {
    serve([task(1, 'Alpha', 1, 0, { version: 4 }), task(2, 'Working', 2, 0)]);
    api.moveTask.mockImplementation(async (id, body) => {
      server = server.map((t) => (t.id === id ? { ...t, columnId: body.columnId, position: body.position, version: t.version + 1 } : t));
      return { task: server.find((t) => t.id === id) };
    });
    renderAt('/board');
    await dragTo('Alpha', 'Doing', 1000);

    await waitFor(() => expect(api.moveTask).toHaveBeenCalledWith(1, { columnId: 2, position: 1, version: 4 }));
    await waitFor(() => expect(titlesIn('Doing')).toEqual(['Working', 'Alpha']));
    expect(titlesIn('To Do')).toEqual([]);
  });

  it('dragging to the top of a column saves position 0', async () => {
    serve([task(1, 'Alpha', 1, 0), task(2, 'Working', 2, 0)]);
    api.moveTask.mockResolvedValue({ task: {} });
    renderAt('/board');
    await dragTo('Alpha', 'Doing', 0);
    await waitFor(() => expect(api.moveTask).toHaveBeenCalledWith(1, { columnId: 2, position: 0, version: 1 }));
  });

  it('shows the new order straight away, before the server has answered', async () => {
    serve([task(1, 'Alpha', 1, 0)]);
    let release;
    api.moveTask.mockReturnValue(new Promise((r) => { release = r; }));
    renderAt('/board');
    await dragTo('Alpha', 'Done', 1000);
    await waitFor(() => expect(titlesIn('Done')).toEqual(['Alpha']));
    release({ task: {} });
  });

  it('dropping a card back where it was does not call the server', async () => {
    serve([task(1, 'Alpha', 1, 0), task(2, 'Beta', 1, 1)]);
    renderAt('/board');
    await dragTo('Alpha', 'To Do', 0);
    expect(api.moveTask).not.toHaveBeenCalled();
  });

  it('the "Move" dropdown is a keyboard-friendly way to move a card to another column', async () => {
    serve([task(1, 'Alpha', 1, 0), task(2, 'Working', 2, 0)]);
    api.moveTask.mockResolvedValue({ task: {} });
    renderAt('/board');
    const card = await screen.findByRole('article', { name: 'Task Alpha' });
    await userEvent.selectOptions(within(card).getByRole('combobox'), 'Doing');
    await waitFor(() => expect(api.moveTask).toHaveBeenCalledWith(1, { columnId: 2, position: 1, version: 1 }));
  });

  it('when the card was changed by someone else, explains it and reloads the real board', async () => {
    serve([task(1, 'Alpha', 1, 0), task(2, 'Working', 2, 0)]);
    api.moveTask.mockImplementation(async () => {
      server = server.map((t) => (t.id === 1 ? { ...t, columnId: 3, position: 0, version: 2 } : t)); // someone moved it to Done
      throw new ApiError(409, 'This task was changed by someone else.', { code: 'VERSION_CONFLICT', current: server[0] });
    });
    renderAt('/board');
    await dragTo('Alpha', 'Doing', 1000);

    expect(await screen.findByText(/changed by someone else, so the move was not saved/i)).toBeInTheDocument();
    await waitFor(() => expect(titlesIn('Done')).toEqual(['Alpha']));
    expect(titlesIn('Doing')).toEqual(['Working']);
  });

  it('shows another error message and reloads when a move is rejected', async () => {
    serve([task(1, 'Alpha', 1, 0)]);
    api.moveTask.mockRejectedValue(new ApiError(400, 'Please fix the highlighted fields', { code: 'VALIDATION_ERROR', fields: { position: 'bad' } }));
    renderAt('/board');
    await dragTo('Alpha', 'Done', 1000);
    expect(await screen.findByRole('alert')).toHaveTextContent('Please fix the highlighted fields');
    await waitFor(() => expect(titlesIn('To Do')).toEqual(['Alpha']));
  });
});

describe('task form', () => {
  it('shows clear errors and does not call the server when required data is missing', async () => {
    renderAt('/tasks/new');
    await screen.findByRole('heading', { name: 'New task' });
    await userEvent.click(screen.getByRole('button', { name: 'Create task' }));
    expect(await screen.findByText('Title is required')).toBeInTheDocument();
    expect(api.createTask).not.toHaveBeenCalled();
  });

  it('rejects the same person as assignee and reviewer', async () => {
    renderAt('/tasks/new');
    await screen.findByRole('heading', { name: 'New task' });
    await userEvent.type(screen.getByLabelText('Title'), 'Something');
    await userEvent.selectOptions(screen.getByLabelText('Primary assignee'), 'Aisha Khan (member)');
    await userEvent.selectOptions(screen.getByLabelText('Reviewer'), 'Aisha Khan (member)');
    await userEvent.click(screen.getByRole('button', { name: 'Create task' }));
    expect(await screen.findByText('Reviewer must be a different person from the assignee')).toBeInTheDocument();
    expect(api.createTask).not.toHaveBeenCalled();
  });

  it('creates a task with every field and then shows its detail page', async () => {
    api.createTask.mockResolvedValue({ task: task(9, 'Build board', 1, 0) });
    api.getTask.mockResolvedValue({ task: task(9, 'Build board', 1, 0), activity: [] });
    renderAt('/tasks/new');
    await screen.findByRole('heading', { name: 'New task' });
    await userEvent.type(screen.getByLabelText('Title'), '  Build board ');
    await userEvent.type(screen.getByLabelText('Description'), 'Kanban');
    await userEvent.selectOptions(screen.getByLabelText('Sprint'), 'Sprint 1');
    await userEvent.selectOptions(screen.getByLabelText('Priority'), 'high');
    fireEvent.change(screen.getByLabelText('Due date'), { target: { value: '2026-10-20' } });
    await userEvent.selectOptions(screen.getByLabelText('Primary assignee'), 'Bilal Ahmed (member)');
    await userEvent.selectOptions(screen.getByLabelText('Reviewer'), 'Aisha Khan (member)');
    await userEvent.type(screen.getByLabelText('Acceptance criteria'), 'It drags');
    await userEvent.click(screen.getByRole('button', { name: 'Create task' }));

    await waitFor(() => expect(api.createTask).toHaveBeenCalledWith({
      title: 'Build board', description: 'Kanban', priority: 'high', dueDate: '2026-10-20',
      sprintId: 5, assigneeId: 21, reviewerId: 20, acceptanceCriteria: 'It drags', projectId: 1,
    }));
    expect(await screen.findByRole('heading', { name: 'Build board' })).toBeInTheDocument();
  });

  it('shows the server\'s message next to the field it is about', async () => {
    api.createTask.mockRejectedValue(new ApiError(400, 'Please fix the highlighted fields', {
      code: 'VALIDATION_ERROR', fields: { sprintId: 'Sprint does not belong to the selected project' },
    }));
    renderAt('/tasks/new');
    await screen.findByRole('heading', { name: 'New task' });
    await userEvent.type(screen.getByLabelText('Title'), 'Anything');
    await userEvent.click(screen.getByRole('button', { name: 'Create task' }));
    expect(await screen.findByText('Sprint does not belong to the selected project')).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('Please fix the highlighted fields');
    expect(screen.getByLabelText('Sprint')).toHaveAttribute('aria-invalid', 'true');
  });

  it('edit loads the task, saves with its version and keeps the project fixed', async () => {
    const t = task(7, 'Old title', 1, 0, { version: 3 });
    api.getTask.mockResolvedValue({ task: t, activity: [] });
    api.updateTask.mockResolvedValue({ task: { ...t, title: 'New title', version: 4 } });
    renderAt('/tasks/7/edit');
    const title = await screen.findByLabelText('Title');
    expect(title).toHaveValue('Old title');
    expect(screen.getByLabelText('Project')).toBeDisabled();

    await userEvent.clear(title);
    await userEvent.type(title, 'New title');
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(api.updateTask).toHaveBeenCalledWith('7', expect.objectContaining({ title: 'New title', version: 3 })));
  });

  it('on a stale edit it keeps the user\'s work, explains why, and can load the latest version', async () => {
    const t = task(7, 'Old title', 1, 0, { version: 1 });
    const latest = { ...t, title: 'Changed by Bilal', version: 2 };
    api.getTask.mockResolvedValue({ task: t, activity: [] });
    api.updateTask
      .mockRejectedValueOnce(new ApiError(409, 'This task was changed by someone else.', { code: 'VERSION_CONFLICT', current: latest }))
      .mockResolvedValueOnce({ task: { ...latest, title: 'Mine, on top of latest', version: 3 } });
    renderAt('/tasks/7/edit');
    const title = await screen.findByLabelText('Title');
    await userEvent.clear(title);
    await userEvent.type(title, 'Mine');
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }));

    expect(await screen.findByText('Someone else changed this task.')).toBeInTheDocument();
    expect(screen.getByLabelText('Title')).toHaveValue('Mine'); // work is not thrown away

    await userEvent.click(screen.getByRole('button', { name: 'Load the latest version' }));
    expect(screen.getByLabelText('Title')).toHaveValue('Changed by Bilal');
    expect(screen.queryByText('Someone else changed this task.')).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(api.updateTask).toHaveBeenLastCalledWith('7', expect.objectContaining({ version: 2 })));
  });

  it('keeps a deactivated assignee visible when editing an existing task', async () => {
    const t = task(7, 'Old', 1, 0, { assigneeId: 99, assignee: { id: 99, name: 'Gone Person' } });
    api.getTask.mockResolvedValue({ task: t, activity: [] });
    renderAt('/tasks/7/edit');
    await screen.findByLabelText('Title');
    expect(screen.getByLabelText('Primary assignee')).toHaveValue('99');
  });
});

describe('task detail and list', () => {
  it('shows the task and a readable activity history', async () => {
    const t = task(5, 'Ship it', 2, 0, { description: 'Do the thing', acceptanceCriteria: 'Done when shipped', priority: 'high' });
    api.getTask.mockResolvedValue({
      task: t,
      activity: [
        { id: 1, type: 'created', actor: { id: 1, name: 'Admin' }, toColumn: { id: 1, name: 'To Do' }, fromColumn: null, createdAt: 'T1', details: null },
        { id: 2, type: 'moved', actor: { id: 2, name: 'Aisha' }, fromColumn: { id: 1, name: 'To Do' }, toColumn: { id: 2, name: 'Doing' }, createdAt: 'T2', details: null },
        { id: 3, type: 'updated', actor: { id: 2, name: 'Aisha' }, createdAt: 'T3', details: { changes: { priority: { from: 'low', to: 'high' } } } },
      ],
    });
    renderAt('/tasks/5');
    expect(await screen.findByRole('heading', { name: 'Ship it' })).toBeInTheDocument();
    expect(screen.getByText('Do the thing')).toBeInTheDocument();
    expect(screen.getByText('Done when shipped')).toBeInTheDocument();
    expect(screen.getByText(/created this task in To Do/)).toBeInTheDocument();
    expect(screen.getByText(/moved it from To Do to Doing/)).toBeInTheDocument();
    expect(screen.getByText(/Priority: low → high/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Edit task' })).toHaveAttribute('href', '/tasks/5/edit');
  });

  it('says so when a task does not exist', async () => {
    api.getTask.mockRejectedValue(new ApiError(404, 'Task not found'));
    renderAt('/tasks/404');
    expect(await screen.findByText('Task not found.')).toBeInTheDocument();
  });

  it('lists tasks and filters them by priority', async () => {
    serve([task(1, 'Alpha', 1, 0, { priority: 'high' })]);
    renderAt('/tasks');
    expect(await screen.findByRole('link', { name: 'Alpha' })).toBeInTheDocument();
    await userEvent.selectOptions(screen.getByLabelText('Filter by priority'), 'high');
    await waitFor(() => expect(api.listTasks).toHaveBeenLastCalledWith(expect.objectContaining({ priority: 'high' })));
  });
});
