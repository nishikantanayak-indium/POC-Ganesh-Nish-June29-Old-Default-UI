import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { FlaskConical, MoreVertical, Trash2 } from 'lucide-react'
import { PageHeader } from '@/components/layout/PageHeader'
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
import { Textarea } from '@/components/ui/textarea'
import { Skeleton } from '@/components/ui/skeleton'
import { Badge } from '@/components/ui/badge'
import { useToast } from '@/components/ui/use-toast'
import { createProject, deleteProject, listProjects } from '@/api/studio'
import { formatDate } from '@/lib/formatters'
import type { StudioProject } from '@/types/studio'

function CreateProjectDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [minThreshold, setMinThreshold] = useState('5')
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const { toast } = useToast()

  const mutation = useMutation({
    mutationFn: () =>
      createProject({
        name: name.trim(),
        description: description.trim() || undefined,
        min_threshold: minThreshold.trim() ? Math.round(Number(minThreshold)) : undefined,
      }),
    onSuccess: (project) => {
      queryClient.invalidateQueries({ queryKey: ['studio', 'projects'] })
      toast({ title: 'Project created', description: `"${project.name}" is ready.`, variant: 'success' })
      onOpenChange(false)
      setName('')
      setDescription('')
      setMinThreshold('5')
      navigate(`/studio/project/${project.id}`)
    },
    onError: (err) => {
      toast({
        title: 'Could not create project',
        description: err instanceof Error ? err.message : 'Please try again.',
        variant: 'destructive',
      })
    },
  })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New Synthetic Data Project</DialogTitle>
          <DialogDescription>
            Create a project to generate synthetic contract documents that fill gaps in your training data.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="proj-name">Name</Label>
            <Input
              id="proj-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Vendor MSA Gap-fill"
              autoFocus
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="proj-desc">Description (optional)</Label>
            <Textarea
              id="proj-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What this project is for…"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="proj-threshold">Minimum examples per gap</Label>
            <Input
              id="proj-threshold"
              type="number"
              min={1}
              step={1}
              value={minThreshold}
              onChange={(e) => setMinThreshold(e.target.value)}
            />
            <p className="text-xs text-ink-subtle">
              Target number of records to generate for each under-represented element/label combination.
            </p>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button disabled={!name.trim()} loading={mutation.isPending} onClick={() => mutation.mutate()}>
            Create Project
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function DeleteProjectDialog({
  project,
  open,
  onOpenChange,
}: {
  project: StudioProject
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const queryClient = useQueryClient()
  const { toast } = useToast()

  const mutation = useMutation({
    mutationFn: () => deleteProject(project.id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['studio', 'projects'] })
      toast({ title: 'Project deleted', variant: 'success' })
      onOpenChange(false)
    },
    onError: (err) => {
      toast({
        title: 'Could not delete project',
        description: err instanceof Error ? err.message : 'Please try again.',
        variant: 'destructive',
      })
    },
  })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete "{project.name}"?</DialogTitle>
          <DialogDescription>
            This permanently removes the project, its uploaded documents, generated versions, and review history. This
            cannot be undone.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button variant="destructive" loading={mutation.isPending} onClick={() => mutation.mutate()}>
            Delete Project
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function ProjectCard({ project }: { project: StudioProject }) {
  const navigate = useNavigate()
  const [deleteOpen, setDeleteOpen] = useState(false)

  return (
    <>
      <Card hoverable className="flex cursor-pointer flex-col" onClick={() => navigate(`/studio/project/${project.id}`)}>
        <CardHeader className="flex-row items-start justify-between space-y-0">
          <div className="flex items-start gap-3">
            <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-accent-50 text-accent-700 dark:bg-accent-900/40 dark:text-accent-300">
              <FlaskConical className="h-4.5 w-4.5" />
            </div>
            <div>
              <CardTitle className="line-clamp-1">{project.name}</CardTitle>
              <CardDescription className="mt-1 line-clamp-2">
                {project.description || 'No description'}
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
                aria-label="Project actions"
              >
                <MoreVertical className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
              <DropdownMenuItem className="text-danger-600" onClick={() => setDeleteOpen(true)}>
                <Trash2 className="mr-2 h-4 w-4" />
                Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </CardHeader>
        <CardContent className="flex flex-wrap items-center gap-2">
          <Badge variant="secondary">Min {project.min_threshold} per gap</Badge>
          {project.labels.slice(0, 3).map((label) => (
            <Badge key={label} variant="outline">
              {label}
            </Badge>
          ))}
        </CardContent>
        <CardFooter className="mt-auto text-xs text-ink-subtle">
          Created {formatDate(project.created_at)} · Updated {formatDate(project.updated_at)}
        </CardFooter>
      </Card>
      <DeleteProjectDialog project={project} open={deleteOpen} onOpenChange={setDeleteOpen} />
    </>
  )
}

export function StudioProjectsPage() {
  const [createOpen, setCreateOpen] = useState(false)
  const { data, isLoading } = useQuery({
    queryKey: ['studio', 'projects'],
    queryFn: () => listProjects(),
  })

  const projects = data?.projects ?? []

  return (
    <div className="mx-auto max-w-[1600px] px-4 py-8 sm:px-6 lg:px-8">
      <PageHeader
        title="Synthetic Data Studio"
        description="Generate synthetic contract, RFP, and risk documents to fill gaps in your training and evaluation data."
        actions={
          <Button onClick={() => setCreateOpen(true)}>
            <FlaskConical className="h-4 w-4" />
            New Project
          </Button>
        }
      />

      <div className="mt-6">
        {isLoading ? (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-44 w-full" />
            ))}
          </div>
        ) : projects.length === 0 ? (
          <Card className="mx-auto max-w-md py-8 text-center">
            <CardContent className="flex flex-col items-center gap-3 pt-5">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-accent-50 text-accent-700 dark:bg-accent-900/40 dark:text-accent-300">
                <FlaskConical className="h-6 w-6" />
              </div>
              <CardTitle>No projects yet</CardTitle>
              <CardDescription>
                Create your first synthetic data project to start generating documents.
              </CardDescription>
              <Button className="mt-2" onClick={() => setCreateOpen(true)}>
                <FlaskConical className="h-4 w-4" />
                New Project
              </Button>
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {projects.map((project) => (
              <ProjectCard key={project.id} project={project} />
            ))}
          </div>
        )}
      </div>

      <CreateProjectDialog open={createOpen} onOpenChange={setCreateOpen} />
    </div>
  )
}
