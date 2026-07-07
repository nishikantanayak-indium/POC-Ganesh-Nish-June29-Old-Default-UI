import { apiGet } from './client'
import type { DocumentContent, GraphNode } from '@/types/analysis'

export const getDocuments = (workspaceId: string) =>
  apiGet<{ documents: DocumentContent[] }>(`/api/workspaces/${workspaceId}/documents`)

export const getElements = (workspaceId: string) =>
  apiGet<{ elements: GraphNode[] }>(`/api/workspaces/${workspaceId}/elements`)
