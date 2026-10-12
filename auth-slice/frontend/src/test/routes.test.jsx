import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../api.js', () => {
  class ApiError extends Error {
    constructor(status, message) { super(message); this.status = status; }
  }
  return {
    ApiError,
    setUnauthorizedHandler: vi.fn(),
    api: {
      me: vi.fn(), login: vi.fn(), logout: vi.fn(), changePassword: vi.fn(),
      listUsers: vi.fn(), createUser: vi.fn(), resetPassword: vi.fn(), setActive: vi.fn(),
    },
  };
});

import { api, ApiError } from '../api.js';
import { AuthProvider } from '../AuthContext.jsx';
import App from '../App.jsx';

const user = (role, over = {}) => ({
  id: 10, name: 'Test Person', email: 'test@example.com', role, isActive: true, ...over,
});
const loggedInAs = (role, over) => api.me.mockResolvedValue({ user: user(role, over) });
const loggedOut = () => api.me.mockRejectedValue(new ApiError(401, 'Authentication required'));

function renderAt(path) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <AuthProvider><App /></AuthProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  Object.values(api).forEach((fn) => fn.mockReset());
  api.listUsers.mockResolvedValue({ users: [] });
});

describe('route protection', () => {
  it('redirects a signed-out visitor from a protected page to the login page', async () => {
    loggedOut();
    renderAt('/admin/users');
    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeInTheDocument();
    expect(api.listUsers).not.toHaveBeenCalled();
  });

  it('redirects a signed-out visitor from the dashboard to login', async () => {
    loggedOut();
    renderAt('/');
    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeInTheDocument();
  });

  it('keeps the session across a refresh (server says the cookie is still valid)', async () => {
    loggedInAs('member', { name: 'Mia Member' });
    renderAt('/');
    expect(await screen.findByRole('heading', { name: 'Welcome, Mia Member' })).toBeInTheDocument();
  });

  it('blocks a Member from the Users page and hides the nav link', async () => {
    loggedInAs('member');
    renderAt('/admin/users');
    expect(await screen.findByText('Not allowed')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Create user' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Users' })).not.toBeInTheDocument();
    expect(api.listUsers).not.toHaveBeenCalled();
  });

  it('lets an Admin open the Users page and shows the nav link', async () => {
    loggedInAs('admin');
    api.listUsers.mockResolvedValue({ users: [user('member', { id: 11, name: 'Some Member', email: 'some@example.com' })] });
    renderAt('/admin/users');
    expect(await screen.findByRole('heading', { name: 'Create user' })).toBeInTheDocument();
    expect(await screen.findByText('some@example.com')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Users' })).toBeInTheDocument();
  });

  it('only offers the Owner role to an Owner', async () => {
    loggedInAs('admin');
    renderAt('/admin/users');
    await screen.findByRole('heading', { name: 'Create user' });
    expect([...screen.getByLabelText('Role').options].map((o) => o.value)).toEqual(['member', 'admin']);
  });
});

describe('login', () => {
  it('shows a clear error for wrong credentials and clears the password field', async () => {
    loggedOut();
    api.login.mockRejectedValue(new ApiError(401, 'Invalid email or password'));
    renderAt('/login');
    const u = userEvent.setup();

    await u.type(await screen.findByLabelText('Email'), 'test@example.com');
    await u.type(screen.getByLabelText('Password'), 'wrong-password');
    await u.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Invalid email or password');
    expect(screen.getByLabelText('Password')).toHaveValue('');
  });

  it('validates empty fields without calling the server', async () => {
    loggedOut();
    renderAt('/login');
    const u = userEvent.setup();
    await u.click(await screen.findByRole('button', { name: 'Sign in' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Enter your email and password');
    expect(api.login).not.toHaveBeenCalled();
  });

  it('signs in and lands on the dashboard', async () => {
    loggedOut();
    api.login.mockResolvedValue({ user: user('member', { name: 'Mia Member' }) });
    renderAt('/login');
    const u = userEvent.setup();

    await u.type(await screen.findByLabelText('Email'), 'test@example.com');
    await u.type(screen.getByLabelText('Password'), 'correct-password');
    await u.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(await screen.findByRole('heading', { name: 'Welcome, Mia Member' })).toBeInTheDocument();
    expect(api.login).toHaveBeenCalledWith('test@example.com', 'correct-password');
  });

  it('logout ends access and returns to the login page', async () => {
    loggedInAs('member');
    api.logout.mockResolvedValue(null);
    renderAt('/');
    const u = userEvent.setup();

    await u.click(await screen.findByRole('button', { name: 'Log out' }));
    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeInTheDocument();
    expect(api.logout).toHaveBeenCalledTimes(1);
  });
});

describe('create user', () => {
  it('shows the generated password once and removes it when dismissed', async () => {
    loggedInAs('owner');
    api.createUser.mockResolvedValue({
      user: user('member', { id: 20, email: 'new@example.com' }),
      initialPassword: 'Gen3rated-Pass!',
    });
    renderAt('/admin/users');
    const u = userEvent.setup();

    await u.type(await screen.findByLabelText('Full name'), 'New Person');
    await u.type(screen.getByLabelText('Email'), 'new@example.com');
    await u.click(screen.getByRole('button', { name: 'Create user' }));

    expect(await screen.findByTestId('generated-password')).toHaveTextContent('Gen3rated-Pass!');
    expect(api.createUser).toHaveBeenCalledWith({ name: 'New Person', email: 'new@example.com', role: 'member' });

    await u.click(screen.getByRole('button', { name: 'Done' }));
    expect(screen.queryByTestId('generated-password')).not.toBeInTheDocument();
  });

  it('shows the server error for a duplicate email and no password panel', async () => {
    loggedInAs('owner');
    api.createUser.mockRejectedValue(new ApiError(409, 'A user with this email already exists'));
    renderAt('/admin/users');
    const u = userEvent.setup();

    await u.type(await screen.findByLabelText('Full name'), 'Dup Person');
    await u.type(screen.getByLabelText('Email'), 'dup@example.com');
    await u.click(screen.getByRole('button', { name: 'Create user' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('already exists');
    expect(screen.queryByTestId('generated-password')).not.toBeInTheDocument();
  });

  it('validates the form on the client before calling the API', async () => {
    loggedInAs('owner');
    renderAt('/admin/users');
    const u = userEvent.setup();

    await u.type(await screen.findByLabelText('Full name'), 'Valid Name');
    await u.type(screen.getByLabelText('Email'), 'not-an-email');
    await u.click(screen.getByRole('button', { name: 'Create user' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('valid email');
    expect(api.createUser).not.toHaveBeenCalled();
  });
});

describe('change password', () => {
  it('rejects a mismatched confirmation without calling the API', async () => {
    loggedInAs('member');
    renderAt('/change-password');
    const u = userEvent.setup();

    await u.type(await screen.findByLabelText('Current password'), 'old-password-1');
    await u.type(screen.getByLabelText('New password'), 'new-password-123');
    await u.type(screen.getByLabelText('Confirm new password'), 'different-123');
    await u.click(screen.getByRole('button', { name: 'Change password' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('do not match');
    expect(api.changePassword).not.toHaveBeenCalled();
  });

  it('shows the server error when the current password is wrong', async () => {
    loggedInAs('member');
    api.changePassword.mockRejectedValue(new ApiError(400, 'Current password is incorrect'));
    renderAt('/change-password');
    const u = userEvent.setup();

    await u.type(await screen.findByLabelText('Current password'), 'wrong-current');
    await u.type(screen.getByLabelText('New password'), 'new-password-123');
    await u.type(screen.getByLabelText('Confirm new password'), 'new-password-123');
    await u.click(screen.getByRole('button', { name: 'Change password' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Current password is incorrect');
  });

  it('confirms success and clears the fields', async () => {
    loggedInAs('member');
    api.changePassword.mockResolvedValue(null);
    renderAt('/change-password');
    const u = userEvent.setup();

    await u.type(await screen.findByLabelText('Current password'), 'old-password-1');
    await u.type(screen.getByLabelText('New password'), 'new-password-123');
    await u.type(screen.getByLabelText('Confirm new password'), 'new-password-123');
    await u.click(screen.getByRole('button', { name: 'Change password' }));

    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Password changed'));
    expect(api.changePassword).toHaveBeenCalledWith('old-password-1', 'new-password-123');
    expect(screen.getByLabelText('Current password')).toHaveValue('');
  });
});
