import { apiGet } from './client'
import type { PortfolioEntry } from '@/types/analysis'

export const getPortfolio = () => apiGet<{ workspaces: PortfolioEntry[] }>('/api/portfolio')
