import { useAuth } from '../AuthContext.jsx';

export default function Dashboard() {
  const { user } = useAuth();
  return (
    <div className="card">
      <h1>Welcome, {user.name}</h1>
      <dl className="facts">
        <dt>Email</dt><dd>{user.email}</dd>
        <dt>Role</dt><dd>{user.role}</dd>
        <dt>Status</dt><dd>{user.isActive ? 'Active' : 'Deactivated'}</dd>
      </dl>
    </div>
  );
}
