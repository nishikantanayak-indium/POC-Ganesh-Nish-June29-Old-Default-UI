import { Routes, Route, Navigate } from 'react-router-dom'
import LandingPage from './components/LandingPage'
import WorkspacesPage from './pages/WorkspacesPage'
import WorkspacePage from './pages/WorkspacePage'
import ChatPage from './pages/ChatPage'
import StudioProjectsPage from './pages/StudioProjectsPage'
import StudioProjectPage from './pages/StudioProjectPage'
import GlobalToastContainer from './components/GlobalToastContainer'
import CustomCursor from './components/CustomCursor'

export default function App() {
  return (
    <>
      <CustomCursor />
      <Routes>
        <Route path="/" element={<LandingPage />} />
        <Route path="/workspaces" element={<WorkspacesPage />} />
        <Route path="/workspace/:workspaceId" element={<WorkspacePage />} />
        <Route path="/workspace/:workspaceId/chat" element={<ChatPage />} />
        <Route path="/workspace/:workspaceId/:tab" element={<WorkspacePage />} />
        <Route path="/studio" element={<StudioProjectsPage />} />
        <Route path="/studio/project/:projectId" element={<StudioProjectPage />} />
        <Route path="/studio/project/:projectId/:tab" element={<StudioProjectPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      <GlobalToastContainer />
    </>
  )
}
