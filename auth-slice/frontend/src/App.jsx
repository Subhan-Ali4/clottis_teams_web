import { Navigate, Route, Routes } from 'react-router-dom';
import ProtectedRoute from './components/ProtectedRoute.jsx';
import Layout from './components/Layout.jsx';
import Login from './pages/Login.jsx';
import Dashboard from './pages/Dashboard.jsx';
import ChangePassword from './pages/ChangePassword.jsx';
import Users from './pages/Users.jsx';
import Board from './pages/Board.jsx';
import TaskList from './pages/TaskList.jsx';
import TaskForm from './pages/TaskForm.jsx';
import TaskDetail from './pages/TaskDetail.jsx';

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />

      <Route element={<ProtectedRoute><Layout /></ProtectedRoute>}>
        <Route index element={<Dashboard />} />
        <Route path="change-password" element={<ChangePassword />} />
        <Route path="board" element={<Board />} />
        <Route path="tasks" element={<TaskList />} />
        <Route path="tasks/new" element={<TaskForm />} />
        <Route path="tasks/:id" element={<TaskDetail />} />
        <Route path="tasks/:id/edit" element={<TaskForm />} />
        <Route
          path="admin/users"
          element={<ProtectedRoute roles={['owner', 'admin']}><Users /></ProtectedRoute>}
        />
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
