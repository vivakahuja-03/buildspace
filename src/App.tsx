import { HashRouter, Route, Routes } from 'react-router-dom';
import AuthGate from './components/AuthGate';
import Layout from './components/Layout';
import { DataProvider } from './data/store';
import Budget from './pages/Budget';
import Dashboard from './pages/Dashboard';
import Documents from './pages/Documents';
import Materials from './pages/Materials';
import ProjectDetail from './pages/ProjectDetail';
import Projects from './pages/Projects';
import Reports from './pages/Reports';
import Schedule from './pages/Schedule';
import Search from './pages/Search';
import Settings from './pages/Settings';
import Tasks from './pages/Tasks';
import Team from './pages/Team';
export default function App() {
  return (
    <AuthGate><DataProvider><HashRouter><Routes><Route element={<Layout />}>
      <Route index element={<Dashboard />} /><Route path="projects" element={<Projects />} /><Route path="projects/:id" element={<ProjectDetail />} /><Route path="schedule" element={<Schedule />} />
      <Route path="tasks" element={<Tasks />} /><Route path="team" element={<Team />} /><Route path="materials" element={<Materials />} /><Route path="budget" element={<Budget />} />
      <Route path="documents" element={<Documents />} /><Route path="reports" element={<Reports />} /><Route path="settings" element={<Settings />} /><Route path="search" element={<Search />} />
      <Route path="*" element={<Search notFound />} />
    </Route></Routes></HashRouter></DataProvider></AuthGate>
  );
}
