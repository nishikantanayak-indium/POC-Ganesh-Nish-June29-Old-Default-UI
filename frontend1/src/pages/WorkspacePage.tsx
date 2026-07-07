import { useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Library, MessageSquare, MoreVertical, Pencil, RotateCcw, Trash2 } from 'lucide-react'
import { PageHeader } from '@/components/layout/PageHeader'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { useToast } from '@/components/ui/use-toast'
import { deleteWorkspace, getStatus, getWorkspace, resetWorkspace, updateWorkspace } from '@/api/workspaces'
import { WorkflowPanel } from '@/components/workspace/WorkflowPanel'
import { SyntheticLibraryModal } from '@/components/workspace/SyntheticLibraryModal'
import { ElementsView } from '@/components/workspace/ElementsView'
import { KnowledgeGraph } from '@/components/workspace/KnowledgeGraph'
import { TraceabilityView } from '@/components/workspace/TraceabilityView'
import { ChatWindow } from '@/components/workspace/ChatWindow'
import { elementStyle } from '@/lib/domain-taxonomy'
import { cn } from '@/lib/utils'
import type { ElementType } from '@/types/analysis'

const TAB_IDS = ['ingest', 'elements', 'graph', 'traceability'] as const
type TabId = (typeof TAB_IDS)[number]

const TAB_LABELS: Record<TabId, string> = {
  ingest: 'Ingest',
  elements: 'Explorer',
  graph: 'Graph',
  traceability: 'Traceability',
}

function RenameDialog({
  workspaceId,
  currentName,
  currentDescription,
  open,
  onOpenChange,
}: {
  workspaceId: string
  currentName: string
  currentDescription?: string
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const [name, setName] = useState(currentName)
  const [description, setDescription] = useState(currentDescription ?? '')
  const queryClient = useQueryClient()
  const { toast } = useToast()

  const mutation = useMutation({
    mutationFn: () => updateWorkspace(workspaceId, name.trim(), description.trim() || undefined),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['workspace', workspaceId] })
      queryClient.invalidateQueries({ queryKey: ['workspaces'] })
      toast({ title: 'Workspace updated', variant: 'success' })
      onOpenChange(false)
    },
    onError: (err) => {
      toast({
        title: 'Could not update workspace',
        description: err instanceof Error ? err.message : 'Please try again.',
        variant: 'destructive',
      })
    },
  })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Rename Workspace</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="ws-rename-name">Name</Label>
            <Input id="ws-rename-name" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ws-rename-desc">Description</Label>
            <Textarea id="ws-rename-desc" value={description} onChange={(e) => setDescription(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button disabled={!name.trim()} loading={mutation.isPending} onClick={() => mutation.mutate()}>
            Save Changes
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function ResetDialog({ workspaceId, open, onOpenChange }: { workspaceId: string; open: boolean; onOpenChange: (open: boolean) => void }) {
  const queryClient = useQueryClient()
  const { toast } = useToast()

  const mutation = useMutation({
    mutationFn: () => resetWorkspace(workspaceId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['workspace', workspaceId, 'status'] })
      queryClient.invalidateQueries({ queryKey: ['workspace', workspaceId, 'elements'] })
      queryClient.invalidateQueries({ queryKey: ['workspace', workspaceId, 'documents'] })
      queryClient.invalidateQueries({ queryKey: ['workspace', workspaceId, 'graph'], exact: false })
      queryClient.invalidateQueries({ queryKey: ['workspace', workspaceId, 'coverage'] })
      queryClient.invalidateQueries({ queryKey: ['workspace', workspaceId, 'cross-doc'] })
      toast({ title: 'Workspace reset', description: 'All ingested data has been cleared.', variant: 'success' })
      onOpenChange(false)
    },
    onError: (err) => {
      toast({
        title: 'Could not reset workspace',
        description: err instanceof Error ? err.message : 'Please try again.',
        variant: 'destructive',
      })
    },
  })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Reset workspace data?</DialogTitle>
          <DialogDescription>
            This clears all ingested documents, elements, graph data, and coverage results in this workspace. The
            workspace itself is kept.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button variant="destructive" loading={mutation.isPending} onClick={() => mutation.mutate()}>
            Reset Data
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function DeleteDialog({ workspaceId, name, open, onOpenChange }: { workspaceId: string; name: string; open: boolean; onOpenChange: (open: boolean) => void }) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { toast } = useToast()

  const mutation = useMutation({
    mutationFn: () => deleteWorkspace(workspaceId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['workspaces'] })
      toast({ title: 'Workspace deleted', variant: 'success' })
      navigate('/workspaces')
    },
    onError: (err) => {
      toast({
        title: 'Could not delete workspace',
        description: err instanceof Error ? err.message : 'Please try again.',
        variant: 'destructive',
      })
    },
  })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete "{name}"?</DialogTitle>
          <DialogDescription>
            This permanently removes the workspace, its documents, graph, and analysis history. This cannot be undone.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button variant="destructive" loading={mutation.isPending} onClick={() => mutation.mutate()}>
            Delete Workspace
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export function WorkspacePage() {
  const { workspaceId, tab } = useParams<{ workspaceId: string; tab?: string }>()
  const navigate = useNavigate()

  const activeTab: TabId = TAB_IDS.includes(tab as TabId) ? (tab as TabId) : 'ingest'
  const [visitedTabs, setVisitedTabs] = useState<Set<TabId>>(new Set([activeTab]))
  const [graphRefreshKey, setGraphRefreshKey] = useState(0)
  const [renameOpen, setRenameOpen] = useState(false)
  const [resetOpen, setResetOpen] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [libraryOpen, setLibraryOpen] = useState(false)

  if (!workspaceId) return null

  const { data: workspace, isLoading: workspaceLoading } = useQuery({
    queryKey: ['workspace', workspaceId],
    queryFn: () => getWorkspace(workspaceId),
  })

  const { data: status } = useQuery({
    queryKey: ['workspace', workspaceId, 'status'],
    queryFn: () => getStatus(workspaceId),
  })

  const typeCountEntries = useMemo(() => {
    if (!status?.type_counts) return []
    return Object.entries(status.type_counts).filter(([, count]) => count > 0)
  }, [status])

  const handleTabChange = (next: string) => {
    const nextTab = next as TabId
    setVisitedTabs((prev) => {
      if (prev.has(nextTab)) return prev
      const updated = new Set(prev)
      updated.add(nextTab)
      return updated
    })
    navigate(`/workspace/${workspaceId}/${nextTab}`)
  }

  if (workspaceLoading || !workspace) {
    return (
      <div className="space-y-4 px-4 py-8 sm:px-6 lg:px-8">
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    )
  }

  return (
    <div className="px-4 py-8 sm:px-6 lg:px-8">
      <PageHeader
        title={workspace.name}
        description={workspace.description}
        actions={
          <>
            <Button variant="outline" asChild>
              <Link to={`/workspace/${workspaceId}/chat`}>
                <MessageSquare className="h-4 w-4" />
                Chat
              </Link>
            </Button>
            <Button variant="outline" onClick={() => setResetOpen(true)}>
              <RotateCcw className="h-4 w-4" />
              Reset
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" aria-label="Workspace actions">
                  <MoreVertical className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => setRenameOpen(true)}>
                  <Pencil className="mr-2 h-4 w-4" />
                  Rename
                </DropdownMenuItem>
                <DropdownMenuItem className="text-danger-600" onClick={() => setDeleteOpen(true)}>
                  <Trash2 className="mr-2 h-4 w-4" />
                  Delete
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </>
        }
      />

      {status && (
        <div className="mt-4 flex flex-wrap items-center gap-2 text-sm text-ink-muted dark:text-ink-subtle">
          <span>
            <span className="font-medium text-ink dark:text-ink-inverted">{status.nodes}</span> nodes
          </span>
          <span className="text-ink-subtle">·</span>
          <span>
            <span className="font-medium text-ink dark:text-ink-inverted">{status.edges}</span> edges
          </span>
          {typeCountEntries.length > 0 && <span className="text-ink-subtle">·</span>}
          {typeCountEntries.map(([type, count]) => {
            const style = elementStyle(type as ElementType)
            return (
              <Badge key={type} variant="outline" className={cn('gap-1', style.badgeClass)}>
                <span className={cn('h-1.5 w-1.5 rounded-full', style.dotClass)} />
                {count} {style.label}
              </Badge>
            )
          })}
        </div>
      )}

      <Tabs value={activeTab} onValueChange={handleTabChange} className="mt-6">
        <TabsList>
          {TAB_IDS.map((id) => (
            <TabsTrigger key={id} value={id}>
              {TAB_LABELS[id]}
            </TabsTrigger>
          ))}
        </TabsList>

        <TabsContent value="ingest" forceMount className={cn(activeTab === 'ingest' ? 'block' : 'hidden')}>
          {visitedTabs.has('ingest') && (
            <div className="mx-auto max-w-4xl space-y-4">
              <div className="flex justify-end">
                <Button variant="outline" onClick={() => setLibraryOpen(true)}>
                  <Library className="h-4 w-4" />
                  Add from Synthetic Library
                </Button>
              </div>
              <WorkflowPanel
                workspaceId={workspaceId}
                onPipelineComplete={() => setGraphRefreshKey((k) => k + 1)}
              />
            </div>
          )}
        </TabsContent>

        <TabsContent value="elements" forceMount className={cn(activeTab === 'elements' ? 'block' : 'hidden')}>
          {visitedTabs.has('elements') && <ElementsView workspaceId={workspaceId} />}
        </TabsContent>

        <TabsContent value="graph" forceMount className={cn(activeTab === 'graph' ? 'block' : 'hidden')}>
          {visitedTabs.has('graph') && <KnowledgeGraph workspaceId={workspaceId} refreshKey={graphRefreshKey} />}
        </TabsContent>

        <TabsContent value="traceability" forceMount className={cn(activeTab === 'traceability' ? 'block' : 'hidden')}>
          {visitedTabs.has('traceability') && <TraceabilityView workspaceId={workspaceId} />}
        </TabsContent>
      </Tabs>

      <ChatWindow workspaceId={workspaceId} />

      <RenameDialog
        workspaceId={workspaceId}
        currentName={workspace.name}
        currentDescription={workspace.description}
        open={renameOpen}
        onOpenChange={setRenameOpen}
      />
      <ResetDialog workspaceId={workspaceId} open={resetOpen} onOpenChange={setResetOpen} />
      <DeleteDialog workspaceId={workspaceId} name={workspace.name} open={deleteOpen} onOpenChange={setDeleteOpen} />
      <SyntheticLibraryModal
        workspaceId={workspaceId}
        workspaceName={workspace.name}
        open={libraryOpen}
        onOpenChange={setLibraryOpen}
      />
    </div>
  )
}
