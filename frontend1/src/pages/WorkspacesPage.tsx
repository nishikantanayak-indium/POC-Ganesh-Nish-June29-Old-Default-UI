import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowDown, ArrowUp, FolderPlus, LayoutGrid, Layers, MoreVertical, Pencil, Table2, Trash2 } from 'lucide-react'
import { PageHeader } from '@/components/layout/PageHeader'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Textarea } from '@/components/ui/textarea'
import { Skeleton } from '@/components/ui/skeleton'
import { useToast } from '@/components/ui/use-toast'
import { createWorkspace, deleteWorkspace, listWorkspaces, updateWorkspace } from '@/api/workspaces'
import { getPortfolio } from '@/api/portfolio'
import { cn } from '@/lib/utils'
import { formatDate, formatDateTime } from '@/lib/formatters'
import type { PortfolioEntry, Workspace } from '@/types/analysis'

function CreateWorkspaceDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const { toast } = useToast()

  const mutation = useMutation({
    mutationFn: () => createWorkspace(name.trim(), description.trim() || undefined),
    onSuccess: (workspace) => {
      queryClient.invalidateQueries({ queryKey: ['workspaces'] })
      toast({ title: 'Workspace created', description: `"${workspace.name}" is ready.`, variant: 'success' })
      onOpenChange(false)
      setName('')
      setDescription('')
      navigate(`/workspace/${workspace.id}`)
    },
    onError: (err) => {
      toast({
        title: 'Could not create workspace',
        description: err instanceof Error ? err.message : 'Please try again.',
        variant: 'destructive',
      })
    },
  })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New Workspace</DialogTitle>
          <DialogDescription>Create a workspace to ingest and analyze a set of contracts.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="ws-name">Name</Label>
            <Input
              id="ws-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Q3 Vendor Contracts"
              autoFocus
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ws-desc">Description (optional)</Label>
            <Textarea
              id="ws-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What this workspace is for…"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button disabled={!name.trim()} loading={mutation.isPending} onClick={() => mutation.mutate()}>
            Create Workspace
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function RenameWorkspaceDialog({
  workspace,
  open,
  onOpenChange,
}: {
  workspace: Workspace
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const [name, setName] = useState(workspace.name)
  const [description, setDescription] = useState(workspace.description ?? '')
  const queryClient = useQueryClient()
  const { toast } = useToast()

  const mutation = useMutation({
    mutationFn: () => updateWorkspace(workspace.id, name.trim(), description.trim() || undefined),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['workspaces'] })
      queryClient.invalidateQueries({ queryKey: ['workspace', workspace.id] })
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
            <Label htmlFor="rename-name">Name</Label>
            <Input id="rename-name" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="rename-desc">Description</Label>
            <Textarea id="rename-desc" value={description} onChange={(e) => setDescription(e.target.value)} />
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

function DeleteWorkspaceDialog({
  workspace,
  open,
  onOpenChange,
}: {
  workspace: Workspace
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const queryClient = useQueryClient()
  const { toast } = useToast()

  const mutation = useMutation({
    mutationFn: () => deleteWorkspace(workspace.id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['workspaces'] })
      toast({ title: 'Workspace deleted', variant: 'success' })
      onOpenChange(false)
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
          <DialogTitle>Delete "{workspace.name}"?</DialogTitle>
          <DialogDescription>
            This permanently removes the workspace, its documents, graph, and analysis history. This cannot be
            undone.
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

function WorkspaceCard({ workspace }: { workspace: Workspace }) {
  const navigate = useNavigate()
  const [renameOpen, setRenameOpen] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)

  return (
    <>
      <Card
        hoverable
        className="flex cursor-pointer flex-col"
        onClick={() => navigate(`/workspace/${workspace.id}`)}
      >
        <CardHeader className="flex-row items-start justify-between space-y-0">
          <div className="flex items-start gap-3">
            <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-slate-50 text-slate-700 dark:bg-slate-900/40 dark:text-slate-200">
              <Layers className="h-4.5 w-4.5" />
            </div>
            <div>
              <CardTitle className="line-clamp-1">{workspace.name}</CardTitle>
              <CardDescription className="mt-1 line-clamp-2">
                {workspace.description || 'No description'}
              </CardDescription>
            </div>
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="shrink-0"
                onClick={(e) => e.stopPropagation()}
                aria-label="Workspace actions"
              >
                <MoreVertical className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
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
        </CardHeader>
        <CardFooter className="mt-auto text-xs text-ink-subtle">
          Created {formatDate(workspace.created_at)} · Updated {formatDate(workspace.updated_at)}
        </CardFooter>
      </Card>
      <RenameWorkspaceDialog workspace={workspace} open={renameOpen} onOpenChange={setRenameOpen} />
      <DeleteWorkspaceDialog workspace={workspace} open={deleteOpen} onOpenChange={setDeleteOpen} />
    </>
  )
}

type SortKey = 'name' | 'coverage' | 'gaps' | 'contradictions' | 'updated_at'

function coveragePct(e: PortfolioEntry): number {
  return e.requirements_total > 0 ? (e.requirements_covered / e.requirements_total) * 100 : 0
}

// Denser, sortable view of the same workspace data — for comparing coverage/
// gaps/contradictions across several deals side by side, which a card grid
// can't do well. Same navigation as clicking a card.
function PortfolioTable() {
  const navigate = useNavigate()
  const [sortKey, setSortKey] = useState<SortKey>('updated_at')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')

  const { data, isLoading } = useQuery({
    queryKey: ['portfolio'],
    queryFn: () => getPortfolio(),
  })
  const entries = data?.workspaces ?? []

  const sorted = useMemo(() => {
    const withKey = entries.map((e) => ({
      entry: e,
      value:
        sortKey === 'name' ? e.name.toLowerCase()
        : sortKey === 'coverage' ? coveragePct(e)
        : sortKey === 'gaps' ? e.gaps_count
        : sortKey === 'contradictions' ? e.contradictions_count
        : Date.parse(e.updated_at),
    }))
    withKey.sort((a, b) => {
      if (a.value < b.value) return sortDir === 'asc' ? -1 : 1
      if (a.value > b.value) return sortDir === 'asc' ? 1 : -1
      return 0
    })
    return withKey.map((w) => w.entry)
  }, [entries, sortKey, sortDir])

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortKey(key)
      setSortDir('desc')
    }
  }

  const SortHeader = ({ label, sortKeyValue }: { label: string; sortKeyValue: SortKey }) => (
    <button
      type="button"
      onClick={() => toggleSort(sortKeyValue)}
      className="flex items-center gap-1 font-medium hover:text-ink dark:hover:text-ink-inverted"
    >
      {label}
      {sortKey === sortKeyValue && (sortDir === 'asc' ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />)}
    </button>
  )

  if (isLoading) {
    return <Skeleton className="h-64 w-full" />
  }

  if (entries.length === 0) {
    return (
      <Card className="mx-auto max-w-md py-8 text-center">
        <CardContent className="pt-5">
          <CardDescription>No workspaces with ingested data yet.</CardDescription>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead><SortHeader label="Name" sortKeyValue="name" /></TableHead>
            <TableHead><SortHeader label="Coverage" sortKeyValue="coverage" /></TableHead>
            <TableHead><SortHeader label="Gaps" sortKeyValue="gaps" /></TableHead>
            <TableHead><SortHeader label="Contradictions" sortKeyValue="contradictions" /></TableHead>
            <TableHead><SortHeader label="Last Updated" sortKeyValue="updated_at" /></TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {sorted.map((e) => {
            const pct = Math.round(coveragePct(e))
            return (
              <TableRow
                key={e.workspace_id}
                className="cursor-pointer"
                onClick={() => navigate(`/workspace/${e.workspace_id}`)}
              >
                <TableCell className="font-medium text-ink dark:text-ink-inverted">{e.name}</TableCell>
                <TableCell>
                  <Badge variant={pct >= 75 ? 'success' : pct >= 40 ? 'warning' : 'danger'}>
                    {pct}% ({e.requirements_covered}/{e.requirements_total})
                  </Badge>
                </TableCell>
                <TableCell>
                  {e.gaps_count > 0 ? (
                    <Badge variant="warning">{e.gaps_count}</Badge>
                  ) : (
                    <span className="text-ink-subtle">0</span>
                  )}
                </TableCell>
                <TableCell>
                  {e.contradictions_count > 0 ? (
                    <Badge variant="danger">{e.contradictions_count}</Badge>
                  ) : (
                    <span className="text-ink-subtle">0</span>
                  )}
                </TableCell>
                <TableCell className="text-ink-subtle">{formatDateTime(e.updated_at)}</TableCell>
              </TableRow>
            )
          })}
        </TableBody>
      </Table>
    </Card>
  )
}

export function WorkspacesPage() {
  const [createOpen, setCreateOpen] = useState(false)
  const [view, setView] = useState<'cards' | 'table'>('cards')
  const { data, isLoading } = useQuery({
    queryKey: ['workspaces'],
    queryFn: () => listWorkspaces(),
  })

  const workspaces = data?.workspaces ?? []

  return (
    <div className="mx-auto max-w-[1600px] px-4 py-8 sm:px-6 lg:px-8">
      <PageHeader
        title="Workspaces"
        description="Analysis workspaces for ingesting and tracing contracts and requirements."
        actions={
          <div className="flex items-center gap-2">
            <div className="flex rounded-md border border-border p-0.5 dark:border-border-dark">
              <button
                type="button"
                onClick={() => setView('cards')}
                aria-label="Card view"
                className={cn(
                  'rounded-sm p-1.5 transition-colors',
                  view === 'cards'
                    ? 'bg-surface-subtle text-ink dark:bg-surface-dark-subtle dark:text-ink-inverted'
                    : 'text-ink-subtle hover:text-ink dark:hover:text-ink-inverted',
                )}
              >
                <LayoutGrid className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={() => setView('table')}
                aria-label="Table view — compare deals"
                className={cn(
                  'rounded-sm p-1.5 transition-colors',
                  view === 'table'
                    ? 'bg-surface-subtle text-ink dark:bg-surface-dark-subtle dark:text-ink-inverted'
                    : 'text-ink-subtle hover:text-ink dark:hover:text-ink-inverted',
                )}
              >
                <Table2 className="h-4 w-4" />
              </button>
            </div>
            <Button onClick={() => setCreateOpen(true)}>
              <FolderPlus className="h-4 w-4" />
              New Workspace
            </Button>
          </div>
        }
      />

      <div className="mt-6">
        {view === 'table' ? (
          <PortfolioTable />
        ) : isLoading ? (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-40 w-full" />
            ))}
          </div>
        ) : workspaces.length === 0 ? (
          <Card className="mx-auto max-w-md py-8 text-center">
            <CardContent className="flex flex-col items-center gap-3 pt-5">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-slate-50 text-slate-700 dark:bg-slate-900/40 dark:text-slate-200">
                <Layers className="h-6 w-6" />
              </div>
              <CardTitle>No workspaces yet</CardTitle>
              <CardDescription>Create your first workspace to start ingesting contracts.</CardDescription>
              <Button className="mt-2" onClick={() => setCreateOpen(true)}>
                <FolderPlus className="h-4 w-4" />
                New Workspace
              </Button>
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {workspaces.map((workspace) => (
              <WorkspaceCard key={workspace.id} workspace={workspace} />
            ))}
          </div>
        )}
      </div>

      <CreateWorkspaceDialog open={createOpen} onOpenChange={setCreateOpen} />
    </div>
  )
}
