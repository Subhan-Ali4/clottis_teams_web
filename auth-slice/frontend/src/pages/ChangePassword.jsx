import { useState } from 'react';
import { api } from '../api.js';

export default function ChangePassword() {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  const [busy, setBusy] = useState(false);

  const onSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setSuccess(false);

    if (!current) return setError('Enter your current password.');
    if (next.length < 8 || next.length > 128) return setError('New password must be 8 to 128 characters.');
    if (next !== confirm) return setError('New password and confirmation do not match.');
    if (next === current) return setError('New password must be different from the current one.');

    setBusy(true);
    try {
      await api.changePassword(current, next);
      setSuccess(true);
      setCurrent(''); setNext(''); setConfirm('');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="card" onSubmit={onSubmit} noValidate>
      <h1>Change password</h1>
      {success && <p className="alert alert-success" role="status">Password changed. Use the new password next time you sign in.</p>}
      {error && <p className="alert alert-error" role="alert">{error}</p>}

      <label htmlFor="current">Current password</label>
      <input id="current" type="password" autoComplete="current-password" value={current}
             onChange={(e) => setCurrent(e.target.value)} />

      <label htmlFor="next">New password</label>
      <input id="next" type="password" autoComplete="new-password" value={next}
             onChange={(e) => setNext(e.target.value)} />
      <p className="hint">At least 8 characters.</p>

      <label htmlFor="confirm">Confirm new password</label>
      <input id="confirm" type="password" autoComplete="new-password" value={confirm}
             onChange={(e) => setConfirm(e.target.value)} />

      <button type="submit" className="btn btn-primary" disabled={busy}>
        {busy ? 'Saving…' : 'Change password'}
      </button>
    </form>
  );
}
