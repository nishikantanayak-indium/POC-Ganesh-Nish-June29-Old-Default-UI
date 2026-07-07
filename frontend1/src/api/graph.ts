import { apiGet } from './client'
import type { CrossDocRelationship, GraphData } from '@/types/analysis'

const base = (workspaceId: string) => `/api/workspaces/${workspaceId}/graph`

export const getGraphData = (workspaceId: string, showContains = false) =>
  apiGet<GraphData>(`${base(workspaceId)}/data?show_contains=${showContains}`)

export const getSubgraph = (workspaceId: string, nodeId: string) =>
  apiGet<GraphData>(`${base(workspaceId)}/subgraph/${nodeId}`)

export const getCrossDocRelationships = (workspaceId: string) =>
  apiGet<{ relationships: CrossDocRelationship[]; total: number }>(`${base(workspaceId)}/cross-doc-relationships`)

export const getGraphStats = (workspaceId: string) =>
  apiGet<{ nodes: number; edges: number; type_counts: Record<string, number> }>(`${base(workspaceId)}/stats`)
