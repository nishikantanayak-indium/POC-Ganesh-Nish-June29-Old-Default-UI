// Shared driver for anything that should show up as a tracked pipeline run in a
// workspace's Ingest tab — a manual file upload (WorkflowPanel) and a Synthetic
// Library import (syntheticImportStore) both go through the SAME real
// extraction/graph-build backend steps, so they share this one code path
// instead of each reinventing job tracking, step chips, and a live log.
import { queryClient } from '@/main'
import { usePipelineStore } from '@/store/pipelineStore'
import { useGlobalToastStore } from '@/store/globalToastStore'
import type { LogLine, PipelineJob, PipelineStep, SSEEvent, StepId } from '@/types/analysis'

const STEP_DEFS: { id: StepId; label: string }[] = [
  { id: 'parse', label: 'Parse' },
  { id: 'extract', label: 'Extract' },
  { id: 'graph', label: 'Graph' },
  { id: 'vector', label: 'Vector' },
  { id: 'coverage', label: 'Coverage' },
]

export function freshSteps(): PipelineStep[] {
  return STEP_DEFS.map((s) => ({ id: s.id, label: s.label, status: 'pending' as const }))
}

export function nowStamp() {
  return new Date().toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

function invalidateWorkspaceQueries(workspaceId: string) {
  queryClient.invalidateQueries({ queryKey: ['workspace', workspaceId, 'status'] })
  queryClient.invalidateQueries({ queryKey: ['workspace', workspaceId, 'elements'] })
  queryClient.invalidateQueries({ queryKey: ['workspace', workspaceId, 'documents'] })
  queryClient.invalidateQueries({ queryKey: ['workspace', workspaceId, 'graph'], exact: false })
  queryClient.invalidateQueries({ queryKey: ['workspace', workspaceId, 'coverage'] })
  queryClient.invalidateQueries({ queryKey: ['workspace', workspaceId, 'cross-doc'] })
}

interface RunTrackedPipelineJobOptions {
  workspaceId: string
  workspaceName?: string
  fileNames: string[]
  startMessage?: string
  stream: (onEvent: (e: SSEEvent) => void, signal?: AbortSignal) => Promise<void>
  onPipelineComplete?: () => void
  signal?: AbortSignal
}

export async function runTrackedPipelineJob(opts: RunTrackedPipelineJobOptions): Promise<'done' | 'error'> {
  const { workspaceId, workspaceName, fileNames, stream, onPipelineComplete, signal } = opts

  const jobId = crypto.randomUUID()
  const runNumber = usePipelineStore.getState().nextRunNumber(workspaceId)
  const job: PipelineJob = {
    id: jobId,
    runNumber,
    workspaceId,
    fileNames,
    steps: freshSteps(),
    logs: [{
      time: nowStamp(),
      text: opts.startMessage ?? `Starting run #${runNumber} with ${fileNames.length} file(s).`,
    }],
    status: 'running',
    startedAt: Date.now(),
  }
  usePipelineStore.getState().addJob(job)

  const patchStep = (stepId: StepId, patch: Partial<PipelineStep>) => {
    const current = usePipelineStore.getState().jobsByWorkspace[workspaceId]?.find((j) => j.id === jobId)
    if (!current) return
    const steps = current.steps.map((s) => (s.id === stepId ? { ...s, ...patch } : s))
    usePipelineStore.getState().patchJob(workspaceId, jobId, { steps })
  }

  const appendLog = (line: LogLine) => {
    const current = usePipelineStore.getState().jobsByWorkspace[workspaceId]?.find((j) => j.id === jobId)
    if (!current) return
    usePipelineStore.getState().patchJob(workspaceId, jobId, { logs: [...current.logs, line] })
  }

  let finalStatus: 'done' | 'error' = 'done'

  const handleEvent = (event: SSEEvent) => {
    switch (event.type) {
      case 'step_start':
        patchStep(event.step, { status: 'running', message: event.message })
        appendLog({ time: nowStamp(), text: event.message ?? `${event.step}: started` })
        break
      case 'step_progress':
        patchStep(event.step, { status: 'running', message: event.message, progress: event.progress, count: event.count })
        if (event.message) appendLog({ time: nowStamp(), text: `${event.step}: ${event.message}` })
        break
      case 'step_complete':
        patchStep(event.step, {
          status: 'done',
          message: event.message,
          count: event.count,
          elapsed: event.elapsed,
        })
        appendLog({ time: nowStamp(), text: event.message ?? `${event.step}: complete` })
        break
      case 'pipeline_complete':
        usePipelineStore.getState().patchJob(workspaceId, jobId, {
          status: 'done',
          summary: event.summary,
          finishedAt: Date.now(),
        })
        appendLog({ time: nowStamp(), text: 'Pipeline complete.' })
        invalidateWorkspaceQueries(workspaceId)
        onPipelineComplete?.()
        useGlobalToastStore.getState().push({
          title: 'Pipeline complete',
          description: `Run #${runNumber} finished — ${event.summary.elements} elements, ${event.summary.nodes} nodes.`,
          variant: 'success',
          workspaceId,
          workspaceName,
        })
        break
      case 'error':
        finalStatus = 'error'
        usePipelineStore.getState().patchJob(workspaceId, jobId, { status: 'error', finishedAt: Date.now() })
        if (event.step) patchStep(event.step, { status: 'error', message: event.message })
        appendLog({ time: nowStamp(), text: event.message, level: 'error' })
        useGlobalToastStore.getState().push({
          title: 'Pipeline failed',
          description: event.message,
          variant: 'danger',
          workspaceId,
          workspaceName,
        })
        break
    }
  }

  try {
    await stream(handleEvent, signal)
  } catch (err) {
    finalStatus = 'error'
    const message = err instanceof Error ? err.message : 'Unexpected error running pipeline.'
    usePipelineStore.getState().patchJob(workspaceId, jobId, { status: 'error', finishedAt: Date.now() })
    appendLog({ time: nowStamp(), text: message, level: 'error' })
    useGlobalToastStore.getState().push({
      title: 'Pipeline failed',
      description: message,
      variant: 'danger',
      workspaceId,
      workspaceName,
    })
  }
  return finalStatus
}
