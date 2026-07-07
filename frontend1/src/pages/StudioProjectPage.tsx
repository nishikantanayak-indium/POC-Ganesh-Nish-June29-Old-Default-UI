import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { ArrowLeft } from 'lucide-react'
import { PageHeader } from '@/components/layout/PageHeader'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'
import { getProject, listVersions } from '@/api/studio'
import { GenerateTab } from '@/components/studio/GenerateTab'
import { SMEReviewTab } from '@/components/studio/SMEReviewTab'
import { ValidationTab } from '@/components/studio/ValidationTab'

type TabKey = 'generate' | 'validate' | 'review'

const VALID_TABS: TabKey[] = ['generate', 'validate', 'review']

export function StudioProjectPage() {
  const { projectId, tab } = useParams<{ projectId: string; tab?: string }>()
  const navigate = useNavigate()

  const activeTab: TabKey = VALID_TABS.includes(tab as TabKey) ? (tab as TabKey) : 'generate'
  const [hasVisitedValidate, setHasVisitedValidate] = useState(activeTab === 'validate')
  const [hasVisitedReview, setHasVisitedReview] = useState(activeTab === 'review')

  const { data: project, isLoading: projectLoading } = useQuery({
    queryKey: ['studio', 'project', projectId],
    queryFn: () => getProject(projectId!),
    enabled: !!projectId,
  })

  const { data: versionsData } = useQuery({
    queryKey: ['studio', 'project', projectId, 'versions'],
    queryFn: () => listVersions(projectId!),
    enabled: !!projectId,
  })

  const hasGenerated = (versionsData?.versions.length ?? 0) > 0

  useEffect(() => {
    if (activeTab === 'validate') setHasVisitedValidate(true)
    if (activeTab === 'review') setHasVisitedReview(true)
  }, [activeTab])

  const handleTabChange = (next: string) => {
    if ((next === 'validate' || next === 'review') && !hasGenerated) return
    navigate(`/studio/project/${projectId}/${next}`, { replace: true })
  }

  if (!projectId) return null

  return (
    <div className="px-4 py-8 sm:px-6 lg:px-8">
      <Link
        to="/studio"
        className="mb-3 inline-flex items-center gap-1.5 text-sm font-medium text-ink-muted transition-colors hover:text-ink dark:text-ink-subtle dark:hover:text-ink-inverted"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        Synthetic Data Studio
      </Link>

      {projectLoading ? (
        <Skeleton className="h-14 w-full" />
      ) : (
        <PageHeader title={project?.name ?? 'Project'} description={project?.description} />
      )}

      <Tabs value={activeTab} onValueChange={handleTabChange} className="mt-6">
        <TabsList>
          <TabsTrigger value="generate">Generate</TabsTrigger>
          {hasGenerated ? (
            <TabsTrigger value="validate">Validate</TabsTrigger>
          ) : (
            <Tooltip>
              <TooltipTrigger asChild>
                <span>
                  <TabsTrigger value="validate" disabled>
                    Validate
                  </TabsTrigger>
                </span>
              </TooltipTrigger>
              <TooltipContent>Generate documents first</TooltipContent>
            </Tooltip>
          )}
          {hasGenerated ? (
            <TabsTrigger value="review">Review</TabsTrigger>
          ) : (
            <Tooltip>
              <TooltipTrigger asChild>
                <span>
                  <TabsTrigger value="review" disabled>
                    Review
                  </TabsTrigger>
                </span>
              </TooltipTrigger>
              <TooltipContent>Generate documents first</TooltipContent>
            </Tooltip>
          )}
        </TabsList>

        <TabsContent value="generate" forceMount className={cn(activeTab !== 'generate' && 'hidden')}>
          <div className="mx-auto max-w-5xl">
            <GenerateTab projectId={projectId} />
          </div>
        </TabsContent>

        {hasVisitedValidate && (
          <TabsContent value="validate" forceMount className={cn(activeTab !== 'validate' && 'hidden')}>
            <div className="mx-auto max-w-5xl">
              <ValidationTab projectId={projectId} />
            </div>
          </TabsContent>
        )}

        {hasVisitedReview && (
          <TabsContent value="review" forceMount className={cn(activeTab !== 'review' && 'hidden')}>
            <SMEReviewTab projectId={projectId} />
          </TabsContent>
        )}
      </Tabs>
    </div>
  )
}
