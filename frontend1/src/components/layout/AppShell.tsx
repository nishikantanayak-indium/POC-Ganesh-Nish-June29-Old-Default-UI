import { NavLink, Outlet } from 'react-router-dom'
import { FlaskConical, LayoutGrid } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Logo } from './Logo'
import { ThemeToggle } from './ThemeToggle'

const NAV_ITEMS = [
  { to: '/workspaces', label: 'Workspaces', icon: LayoutGrid },
  { to: '/studio', label: 'Synthetic Studio', icon: FlaskConical },
]

export function AppShell() {
  return (
    <div className="flex min-h-screen flex-col bg-surface-subtle dark:bg-surface-dark">
      <header className="sticky top-0 z-40 border-b border-border bg-surface/95 backdrop-blur dark:border-border-dark dark:bg-surface-dark/95">
        <div className="flex h-14 items-center justify-between px-4 sm:px-6">
          <div className="flex items-center gap-8">
            <NavLink to="/" className="shrink-0">
              <Logo />
            </NavLink>
            <nav className="hidden items-center gap-1 sm:flex">
              {NAV_ITEMS.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  className={({ isActive }) =>
                    cn(
                      'flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium text-ink-muted transition-colors hover:bg-surface-muted hover:text-ink dark:text-ink-subtle dark:hover:bg-surface-dark-subtle dark:hover:text-ink-inverted',
                      isActive && 'bg-navy-50 text-navy-800 hover:bg-navy-50 hover:text-navy-800 dark:bg-navy-900/40 dark:text-navy-200 dark:hover:bg-navy-900/40 dark:hover:text-navy-200',
                    )
                  }
                >
                  <item.icon className="h-4 w-4" />
                  {item.label}
                </NavLink>
              ))}
            </nav>
          </div>
          <ThemeToggle />
        </div>
      </header>
      <main className="flex-1">
        <Outlet />
      </main>
    </div>
  )
}
