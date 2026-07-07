import { apiDelete, apiGet, apiPatch, apiPost } from './client'
import type { AskResponse, Conversation, ConversationMessage } from '@/types/analysis'

const base = (workspaceId: string) => `/api/workspaces/${workspaceId}/chat`

export const askQuestion = (workspaceId: string, question: string) =>
  apiPost<AskResponse>(`${base(workspaceId)}/ask`, { question })

export const listConversations = (workspaceId: string) =>
  apiGet<{ conversations: Conversation[] }>(`${base(workspaceId)}/conversations`)

export const createConversation = (workspaceId: string, title?: string) =>
  apiPost<Conversation>(`${base(workspaceId)}/conversations`, { title })

export const renameConversation = (workspaceId: string, conversationId: string, title: string) =>
  apiPatch<Conversation>(`${base(workspaceId)}/conversations/${conversationId}`, { title })

export const deleteConversation = (workspaceId: string, conversationId: string) =>
  apiDelete<{ deleted: true }>(`${base(workspaceId)}/conversations/${conversationId}`)

export const listMessages = (workspaceId: string, conversationId: string) =>
  apiGet<{ messages: ConversationMessage[] }>(`${base(workspaceId)}/conversations/${conversationId}/messages`)

export const askInConversation = (workspaceId: string, conversationId: string, question: string) =>
  apiPost<AskResponse>(`${base(workspaceId)}/conversations/${conversationId}/ask`, { question })
