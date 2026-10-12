import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../AuthContext.jsx';

// Not signed in  -> redirect to /login (and come back afterwards).
// Wrong role     -> show a clear "not allowed" screen instead of the page.
export default function ProtectedRoute({ roles, children }) {
  const { user, loading } = useAuth();
  const location = useLocation();

  if (loading) return <p className="center muted">Loading…</p>;
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname }} />;

  if (roles && !roles.includes(user.role)) {
    return (
      <div className="card" role="alert">
        <h1>Not allowed</h1>
        <p>Your role (<strong>{user.role}</strong>) does not have access to this page.</p>
      </div>
    );
  }
  return children;
}
