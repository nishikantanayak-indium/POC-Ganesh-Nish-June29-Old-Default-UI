import { apiGet } from './client'
import type { CoverageResult, TraceabilityChain } from '@/types/analysis'

const base = (workspaceId: string) => `/api/workspaces/${workspaceId}/traceability`

export const getCoverage = (workspaceId: string) =>
  apiGet<{ results: CoverageResult[] }>(`${base(workspaceId)}/coverage`)

export const getChain = (workspaceId: string, requirementId: string) =>
  apiGet<TraceabilityChain>(`${base(workspaceId)}/chain/${requirementId}`)
