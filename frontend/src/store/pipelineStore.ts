import { create } from 'zustand'
import type { PipelineJob } from '../types'

interface PipelineState {
  jobs: PipelineJob[]
  runCount: number
  // Add a new job (prepends to list)
  addJob: (job: PipelineJob) => void
  // Pure state patch — fn must be a pure transform, no side effects
  patchJob: (jobId: string, fn: (j: PipelineJob) => PipelineJob) => void
  // Increment run counter and return the new value
  nextRunNumber: () => number
  // Clear all jobs (on graph reset)
  clearJobs: () => void
}

export const usePipelineStore = create<PipelineState>((set, get) => ({
  jobs: [],
  runCount: 0,

  addJob: (job) =>
    set((state) => ({ jobs: [job, ...state.jobs] })),

  patchJob: (jobId, fn) =>
    set((state) => ({
      jobs: state.jobs.map((j) => (j.id === jobId ? fn(j) : j)),
    })),

  nextRunNumber: () => {
    const next = get().runCount + 1
    set({ runCount: next })
    return next
  },

  clearJobs: () => set({ jobs: [], runCount: 0 }),
}))
