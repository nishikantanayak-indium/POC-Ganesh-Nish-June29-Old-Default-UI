import { create } from 'zustand'
import type { PipelineJob } from '@/types/analysis'

interface PipelineState {
  jobsByWorkspace: Record<string, PipelineJob[]>
  addJob: (job: PipelineJob) => void
  patchJob: (workspaceId: string, jobId: string, patch: Partial<PipelineJob>) => void
  nextRunNumber: (workspaceId: string) => number
  clearJobs: (workspaceId: string) => void
}

export const usePipelineStore = create<PipelineState>((set, get) => ({
  jobsByWorkspace: {},

  addJob: (job) =>
    set((state) => ({
      jobsByWorkspace: {
        ...state.jobsByWorkspace,
        [job.workspaceId]: [job, ...(state.jobsByWorkspace[job.workspaceId] ?? [])],
      },
    })),

  patchJob: (workspaceId, jobId, patch) =>
    set((state) => ({
      jobsByWorkspace: {
        ...state.jobsByWorkspace,
        [workspaceId]: (state.jobsByWorkspace[workspaceId] ?? []).map((j) =>
          j.id === jobId ? { ...j, ...patch } : j,
        ),
      },
    })),

  nextRunNumber: (workspaceId) => (get().jobsByWorkspace[workspaceId]?.length ?? 0) + 1,

  clearJobs: (workspaceId) =>
    set((state) => ({
      jobsByWorkspace: { ...state.jobsByWorkspace, [workspaceId]: [] },
    })),
}))

const EMPTY_JOBS: PipelineJob[] = []

export const useWorkspaceJobs = (workspaceId: string) =>
  usePipelineStore((state) => state.jobsByWorkspace[workspaceId] ?? EMPTY_JOBS)

export const useAnyPipelineRunning = () =>
  usePipelineStore((state) => Object.values(state.jobsByWorkspace).some((jobs) => jobs.some((j) => j.status === 'running')))
