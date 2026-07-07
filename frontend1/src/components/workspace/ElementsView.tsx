import { useEffect, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ChevronLeft, ChevronRight, FileText, Inbox, ScanText, Table2, TextCursorInput } from 'lucide-react'

import { cn } from '@/lib/utils'
import { getDocuments, getElements } from '@/api/documents'
import type { DocumentContent, PageContent } from '@/types/analysis'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Separator } from '@/components/ui/separator'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { ElementsTable } from './ElementsTable'
import { TableBlock } from './TableBlock'

interface ElementsViewProps {
  workspaceId: string
}

type ViewMode = 'elements' | 'text' | 'ocr' | 'tables'

function DocumentListSkeleton() {
  return (
    <div className="flex flex-col gap-2 p-3">
      {Array.from({ length: 5 }).map((_, idx) => (
        <Skeleton key={idx} className="h-14 w-full" />
      ))}
    </div>
  )
}

function ContentSkeleton() {
  return (
    <div className="flex flex-col gap-3 p-4">
      <Skeleton className="h-8 w-64" />
      <Skeleton className="h-40 w-full" />
      <Skeleton className="h-40 w-full" />
    </div>
  )
}

function PageNavigator({
  currentPage,
  totalPages,
  onChange,
}: {
  currentPage: number
  totalPages: number
  onChange: (page: number) => void
}) {
  return (
    <div className="flex items-center gap-2 border-b border-border px-4 py-2 dark:border-border-dark">
      <Button
        variant="outline"
        size="icon"
        disabled={currentPage <= 1}
        onClick={() => onChange(currentPage - 1)}
        aria-label="Previous page"
      >
        <ChevronLeft className="h-4 w-4" />
      </Button>
      <span className="text-sm text-ink-muted dark:text-ink-subtle">
        Page {currentPage} of {totalPages}
      </span>
      <Button
        variant="outline"
        size="icon"
        disabled={currentPage >= totalPages}
        onClick={() => onChange(currentPage + 1)}
        aria-label="Next page"
      >
        <ChevronRight className="h-4 w-4" />
      </Button>
      <Input
        type="number"
        min={1}
        max={totalPages}
        value={currentPage}
        onChange={(e) => {
          const value = Number(e.target.value)
          if (!Number.isNaN(value) && value >= 1 && value <= totalPages) {
            onChange(value)
          }
        }}
        className="w-20"
      />
    </div>
  )
}

export function ElementsView({ workspaceId }: ElementsViewProps) {
  const documentsQuery = useQuery({
    queryKey: ['workspace', workspaceId, 'documents'],
    queryFn: () => getDocuments(workspaceId),
  })
  const elementsQuery = useQuery({
    queryKey: ['workspace', workspaceId, 'elements'],
    queryFn: () => getElements(workspaceId),
  })

  const [selectedDocId, setSelectedDocId] = useState<string | undefined>(undefined)
  const [viewMode, setViewMode] = useState<ViewMode>('elements')
  const [currentPage, setCurrentPage] = useState(1)

  const documents = documentsQuery.data?.documents ?? []
  const elements = elementsQuery.data?.elements ?? []

  useEffect(() => {
    if (!selectedDocId && documents.length > 0) {
      setSelectedDocId(documents[0].id)
    }
  }, [documents, selectedDocId])

  useEffect(() => {
    setCurrentPage(1)
  }, [selectedDocId, viewMode])

  const selectedDoc: DocumentContent | undefined = useMemo(
    () => documents.find((doc) => doc.id === selectedDocId),
    [documents, selectedDocId]
  )

  const filteredElements = useMemo(
    () => elements.filter((el) => el.document_id === selectedDocId),
    [elements, selectedDocId]
  )

  const totalPages = selectedDoc?.page_contents.length ?? 0
  const currentPageContent: PageContent | undefined = selectedDoc?.page_contents[currentPage - 1]

  const isLoading = documentsQuery.isLoading || elementsQuery.isLoading

  if (isLoading) {
    return (
      <div className="flex h-[calc(100vh-260px)] min-h-[500px] flex-1">
        <div className="w-64 shrink-0 border-r border-border dark:border-border-dark">
          <DocumentListSkeleton />
        </div>
        <div className="flex-1">
          <ContentSkeleton />
        </div>
      </div>
    )
  }

  if (documents.length === 0) {
    return (
      <div className="flex h-[calc(100vh-260px)] min-h-[500px] flex-1 flex-col items-center justify-center gap-3 p-10 text-center">
        <Inbox className="h-10 w-10 text-ink-subtle" />
        <p className="text-sm font-medium text-ink dark:text-ink-inverted">No documents ingested yet</p>
        <p className="max-w-sm text-sm text-ink-muted dark:text-ink-subtle">
          Head over to the Ingest tab to upload documents and build the knowledge graph for this
          workspace.
        </p>
      </div>
    )
  }

  return (
    <div className="flex h-[calc(100vh-260px)] min-h-[500px] flex-1">
      <div className="flex w-64 shrink-0 flex-col border-r border-border dark:border-border-dark">
        <ScrollArea className="h-full">
          <div className="flex flex-col gap-1 p-2">
            {documents.map((doc) => {
              const isSelected = doc.id === selectedDocId
              return (
                <button
                  key={doc.id}
                  type="button"
                  onClick={() => setSelectedDocId(doc.id)}
                  className={cn(
                    'flex flex-col gap-1 rounded-md px-3 py-2 text-left transition-colors hover:bg-surface-muted dark:hover:bg-surface-dark-subtle',
                    isSelected && 'bg-navy-50 dark:bg-navy-900/40'
                  )}
                >
                  <div className="flex items-center gap-2">
                    <FileText className="h-4 w-4 shrink-0 text-ink-subtle" />
                    <span
                      className={cn(
                        'truncate text-sm font-medium text-ink dark:text-ink-inverted',
                        isSelected && 'text-navy-800 dark:text-navy-200'
                      )}
                    >
                      {doc.name}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 pl-6">
                    <Badge variant="secondary">{doc.type}</Badge>
                    <span className="text-xs text-ink-subtle">{doc.total_pages} pages</span>
                  </div>
                </button>
              )
            })}
          </div>
        </ScrollArea>
      </div>

      <Separator orientation="vertical" />

      <div className="flex flex-1 flex-col overflow-hidden">
        <div className="border-b border-border px-4 pt-2 dark:border-border-dark">
          <Tabs value={viewMode} onValueChange={(value) => setViewMode(value as ViewMode)}>
            <TabsList>
              <TabsTrigger value="elements">
                <Table2 className="mr-1.5 h-4 w-4" />
                Elements
              </TabsTrigger>
              <TabsTrigger value="text">
                <TextCursorInput className="mr-1.5 h-4 w-4" />
                Text
              </TabsTrigger>
              <TabsTrigger value="ocr">
                <ScanText className="mr-1.5 h-4 w-4" />
                OCR
              </TabsTrigger>
              <TabsTrigger value="tables">
                <Table2 className="mr-1.5 h-4 w-4" />
                Tables
              </TabsTrigger>
            </TabsList>
          </Tabs>
        </div>

        {viewMode === 'elements' && (
          <ScrollArea className="flex-1">
            <div className="p-4">
              <ElementsTable elements={filteredElements} />
            </div>
          </ScrollArea>
        )}

        {viewMode !== 'elements' && (
          <div className="flex flex-1 flex-col overflow-hidden">
            {totalPages > 0 ? (
              <>
                <PageNavigator currentPage={currentPage} totalPages={totalPages} onChange={setCurrentPage} />
                <ScrollArea className="flex-1">
                  <div className="p-4">
                    {viewMode === 'text' && (
                      <div className="max-w-3xl whitespace-pre-wrap text-sm leading-relaxed text-ink dark:text-ink-inverted">
                        {currentPageContent?.native_text || 'No native text extracted on this page.'}
                      </div>
                    )}
                    {viewMode === 'ocr' && (
                      <div className="max-w-3xl whitespace-pre-wrap text-sm leading-relaxed text-ink dark:text-ink-inverted">
                        {currentPageContent?.ocr_text || 'No OCR text extracted on this page.'}
                      </div>
                    )}
                    {viewMode === 'tables' && (
                      <div className="flex flex-col gap-4">
                        {currentPageContent && currentPageContent.tables.length > 0 ? (
                          currentPageContent.tables.map((table, idx) => (
                            <TableBlock key={idx} table={table} />
                          ))
                        ) : (
                          <p className="text-sm text-ink-muted dark:text-ink-subtle">
                            No tables extracted on this page.
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                </ScrollArea>
              </>
            ) : (
              <div className="flex flex-1 items-center justify-center p-10 text-sm text-ink-muted dark:text-ink-subtle">
                This document has no page content.
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
