import { create } from 'zustand'
import type { PipelineJob } from '../types'

interface WorkspaceJobs {
  jobs: PipelineJob[]
  runCount: number
}

interface PipelineState {
  byWorkspace: Record<string, WorkspaceJobs>
  addJob: (wsId: string, job: PipelineJob) => void
  patchJob: (wsId: string, jobId: string, fn: (j: PipelineJob) => PipelineJob) => void
  nextRunNumber: (wsId: string) => number
  clearJobs: (wsId: string) => void
}

const empty = (): WorkspaceJobs => ({ jobs: [], runCount: 0 })

export const usePipelineStore = create<PipelineState>((set, get) => ({
  byWorkspace: {},

  addJob: (wsId, job) =>
    set(s => {
      const ws = s.byWorkspace[wsId] ?? empty()
      return { byWorkspace: { ...s.byWorkspace, [wsId]: { ...ws, jobs: [job, ...ws.jobs] } } }
    }),

  patchJob: (wsId, jobId, fn) =>
    set(s => {
      const ws = s.byWorkspace[wsId]
      if (!ws) return s
      return {
        byWorkspace: {
          ...s.byWorkspace,
          [wsId]: { ...ws, jobs: ws.jobs.map(j => (j.id === jobId ? fn(j) : j)) },
        },
      }
    }),

  nextRunNumber: (wsId) => {
    const ws = get().byWorkspace[wsId] ?? empty()
    const next = ws.runCount + 1
    set(s => ({
      byWorkspace: {
        ...s.byWorkspace,
        [wsId]: { ...(s.byWorkspace[wsId] ?? empty()), runCount: next },
      },
    }))
    return next
  },

  clearJobs: (wsId) =>
    set(s => ({ byWorkspace: { ...s.byWorkspace, [wsId]: empty() } })),
}))

// Selector helpers — use these in components to avoid manual slice
export const useWorkspaceJobs = (wsId: string): PipelineJob[] =>
  usePipelineStore(s => s.byWorkspace[wsId]?.jobs ?? [])

export const useAnyPipelineRunning = (): boolean =>
  usePipelineStore(s =>
    Object.values(s.byWorkspace).some(ws => ws.jobs.some(j => j.status === 'running'))
  )
