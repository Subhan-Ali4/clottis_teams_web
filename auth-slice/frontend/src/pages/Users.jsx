import { useCallback, useEffect, useState } from 'react';
import { api } from '../api.js';
import { useAuth } from '../AuthContext.jsx';
import CredentialPanel from '../components/CredentialPanel.jsx';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export default function Users() {
  const { user: me } = useAuth();
  const [users, setUsers] = useState([]);
  const [loadError, setLoadError] = useState('');
  const [credential, setCredential] = useState(null);

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState('member');
  const [formError, setFormError] = useState('');
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState('');

  const load = useCallback(async () => {
    try {
      const r = await api.listUsers();
      setUsers(r.users);
      setLoadError('');
    } catch (err) {
      setLoadError(err.message);
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  const onCreate = async (e) => {
    e.preventDefault();
    setFormError('');
    setCredential(null);
    if (name.trim().length < 2) return setFormError('Enter the full name (at least 2 characters).');
    if (!EMAIL_RE.test(email.trim())) return setFormError('Enter a valid email address.');

    setBusy(true);
    try {
      const r = await api.createUser({ name: name.trim(), email: email.trim(), role });
      setCredential({ title: 'User created', email: r.user.email, password: r.initialPassword });
      setName(''); setEmail(''); setRole('member');
      await load();
    } catch (err) {
      setFormError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const onReset = async (u) => {
    if (!window.confirm(`Reset the password for ${u.email}? They will be signed out everywhere.`)) return;
    setActionError(''); setCredential(null);
    try {
      const r = await api.resetPassword(u.id);
      setCredential({ title: 'Password reset', email: r.user.email, password: r.newPassword });
    } catch (err) {
      setActionError(err.message);
    }
  };

  const onToggle = async (u) => {
    setActionError('');
    try {
      await api.setActive(u.id, !u.isActive);
      await load();
    } catch (err) {
      setActionError(err.message);
    }
  };

  // Admins cannot manage Owners; nobody can reset/deactivate themselves here.
  const canManage = (u) => u.id !== me.id && (me.role === 'owner' || u.role !== 'owner');
  const roleOptions = me.role === 'owner' ? ['member', 'admin', 'owner'] : ['member', 'admin'];

  return (
    <>
      <form className="card" onSubmit={onCreate} noValidate>
        <h1>Create user</h1>
        {formError && <p className="alert alert-error" role="alert">{formError}</p>}

        <label htmlFor="name">Full name</label>
        <input id="name" value={name} onChange={(e) => setName(e.target.value)} />

        <label htmlFor="user-email">Email</label>
        <input id="user-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />

        <label htmlFor="role">Role</label>
        <select id="role" value={role} onChange={(e) => setRole(e.target.value)}>
          {roleOptions.map((r) => <option key={r} value={r}>{r}</option>)}
        </select>

        <p className="hint">A secure initial password is generated for the new user.</p>
        <button type="submit" className="btn btn-primary" disabled={busy}>
          {busy ? 'Creating…' : 'Create user'}
        </button>
      </form>

      {credential && <CredentialPanel {...credential} onDismiss={() => setCredential(null)} />}

      <section className="card">
        <h2>All users</h2>
        {loadError && <p className="alert alert-error" role="alert">{loadError}</p>}
        {actionError && <p className="alert alert-error" role="alert">{actionError}</p>}
        <div className="table-wrap">
          <table>
            <thead>
              <tr><th>Name</th><th>Email</th><th>Role</th><th>Status</th><th>Actions</th></tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id}>
                  <td>{u.name}</td>
                  <td>{u.email}</td>
                  <td><span className={`badge badge-${u.role}`}>{u.role}</span></td>
                  <td>{u.isActive ? 'Active' : 'Deactivated'}</td>
                  <td className="actions">
                    {canManage(u) ? (
                      <>
                        <button type="button" className="btn" onClick={() => onReset(u)}>Reset password</button>
                        <button type="button" className="btn" onClick={() => onToggle(u)}>
                          {u.isActive ? 'Deactivate' : 'Activate'}
                        </button>
                      </>
                    ) : <span className="muted">—</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
