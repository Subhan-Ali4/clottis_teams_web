import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useAuth } from '../AuthContext.jsx';

export default function Layout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const isAdmin = user.role === 'owner' || user.role === 'admin';

  const onLogout = async () => {
    await logout();
    navigate('/login', { replace: true });
  };

  return (
    <>
      <header className="topbar">
        <strong className="brand">Auth Slice</strong>
        <nav aria-label="Main">
          <NavLink to="/" end>Dashboard</NavLink>
          <NavLink to="/change-password">Change password</NavLink>
          {isAdmin && <NavLink to="/admin/users">Users</NavLink>}
        </nav>
        <div className="who">
          <span>{user.name}</span>
          <span className={`badge badge-${user.role}`}>{user.role}</span>
          <button type="button" className="btn btn-ghost" onClick={onLogout}>Log out</button>
        </div>
      </header>
      <main className="page"><Outlet /></main>
    </>
  );
}
