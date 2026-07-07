import { Navigate, Route, BrowserRouter, Routes } from 'react-router-dom'
import { AppShell } from '@/components/layout/AppShell'
import { LandingPage } from '@/pages/LandingPage'
import { WorkspacesPage } from '@/pages/WorkspacesPage'
import { WorkspacePage } from '@/pages/WorkspacePage'
import { ChatPage } from '@/pages/ChatPage'
import { StudioProjectsPage } from '@/pages/StudioProjectsPage'
import { StudioProjectPage } from '@/pages/StudioProjectPage'

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<AppShell />}>
          <Route index element={<LandingPage />} />
          <Route path="workspaces" element={<WorkspacesPage />} />
          <Route path="workspace/:workspaceId" element={<WorkspacePage />} />
          <Route path="workspace/:workspaceId/:tab" element={<WorkspacePage />} />
          <Route path="workspace/:workspaceId/chat" element={<ChatPage />} />
          <Route path="studio" element={<StudioProjectsPage />} />
          <Route path="studio/project/:projectId" element={<StudioProjectPage />} />
          <Route path="studio/project/:projectId/:tab" element={<StudioProjectPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </BrowserRouter>
  )
}
