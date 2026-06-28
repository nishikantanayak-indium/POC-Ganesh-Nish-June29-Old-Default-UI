import { Routes, Route, Navigate } from 'react-router-dom'
import LandingPage from './components/LandingPage'
import WorkspacesPage from './pages/WorkspacesPage'
import WorkspacePage from './pages/WorkspacePage'

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<LandingPage />} />
      <Route path="/workspaces" element={<WorkspacesPage />} />
      <Route path="/workspace/:workspaceId" element={<WorkspacePage />} />
      <Route path="/workspace/:workspaceId/:tab" element={<WorkspacePage />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
