import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { AlertCircle, Check, FlaskConical, Loader2, Plus } from 'lucide-react'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Skeleton } from '@/components/ui/skeleton'
import { getStoreDocuments } from '@/api/studio'
import { useImportStatus, useSyntheticImportStore } from '@/store/syntheticImportStore'
import type { StoreDocument } from '@/types/studio'

const DOC_TYPE_OPTIONS = [
  { value: 'all', label: 'All document types' },
  { value: 'contract', label: 'Contract' },
  { value: 'requirements', label: 'Requirements' },
  { value: 'bid', label: 'Bid' },
  { value: 'amendment', label: 'Amendment' },
]

interface SyntheticLibraryModalProps {
  workspaceId: string
  workspaceName: string
  open: boolean
  onOpenChange: (open: boolean) => void
}

function LibraryRow({
  doc,
  workspaceId,
  workspaceName,
}: {
  doc: StoreDocument
  workspaceId: string
  workspaceName: string
}) {
  const status = useImportStatus(doc.id)
  const alreadyImported = doc.imported_into.includes(workspaceId)

  return (
    <div className="flex items-center justify-between gap-3 rounded-md border border-border px-3 py-2.5 dark:border-border-dark">
      <div className="min-w-0">
        <p className="truncate text-sm font-medium text-ink dark:text-ink-inverted">{doc.title}</p>
        <div className="mt-1 flex flex-wrap items-center gap-1.5">
          <Badge variant="secondary">{doc.doc_type}</Badge>
          {doc.industry && <Badge variant="outline">{doc.industry}</Badge>}
          {doc.language && <Badge variant="outline">{doc.language}</Badge>}
        </div>
      </div>
      <div className="shrink-0">
        {status === 'importing' ? (
          <Button variant="outline" size="sm" disabled>
            <Loader2 className="h-4 w-4 animate-spin" />
            Adding…
          </Button>
        ) : status === 'done' || alreadyImported ? (
          <Button variant="outline" size="sm" disabled>
            <Check className="h-4 w-4" />
            Added
          </Button>
        ) : status === 'error' ? (
          <Button
            variant="outline"
            size="sm"
            className="text-danger-600"
            onClick={() => useSyntheticImportStore.getState().startImport(workspaceId, workspaceName, doc.id, doc.title)}
          >
            <AlertCircle className="h-4 w-4" />
            Retry
          </Button>
        ) : (
          <Button
            variant="outline"
            size="sm"
            onClick={() => useSyntheticImportStore.getState().startImport(workspaceId, workspaceName, doc.id, doc.title)}
          >
            <Plus className="h-4 w-4" />
            Add to workspace
          </Button>
        )}
      </div>
    </div>
  )
}

export function SyntheticLibraryModal({ workspaceId, workspaceName, open, onOpenChange }: SyntheticLibraryModalProps) {
  const [docType, setDocType] = useState('all')

  const { data, isLoading } = useQuery({
    queryKey: ['studio', 'store-documents', docType],
    queryFn: () => getStoreDocuments(docType === 'all' ? undefined : docType),
    enabled: open,
  })

  const documents = data?.documents ?? []

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Synthetic Library</DialogTitle>
          <DialogDescription>
            Add published synthetic documents from the Synthetic Data Studio into this workspace.
          </DialogDescription>
        </DialogHeader>

        <Select value={docType} onValueChange={setDocType}>
          <SelectTrigger className="w-56">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {DOC_TYPE_OPTIONS.map((opt) => (
              <SelectItem key={opt.value} value={opt.value}>
                {opt.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {isLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-14 w-full" />
            ))}
          </div>
        ) : documents.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-10 text-center">
            <FlaskConical className="h-8 w-8 text-ink-subtle" />
            <p className="text-sm font-medium text-ink dark:text-ink-inverted">No synthetic documents found</p>
            <p className="text-xs text-ink-subtle">Publish documents from the Synthetic Data Studio to see them here.</p>
          </div>
        ) : (
          <ScrollArea className="h-96">
            <div className="space-y-2 pr-3">
              {documents.map((doc) => (
                <LibraryRow key={doc.id} doc={doc} workspaceId={workspaceId} workspaceName={workspaceName} />
              ))}
            </div>
          </ScrollArea>
        )}
      </DialogContent>
    </Dialog>
  )
}
