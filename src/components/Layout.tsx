import { useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useData } from '../data/store';
import { notifications } from '../lib/search';
import { cn } from '../lib/utils';
import { ErrorBoundary } from './ErrorBoundary';
import { Modal } from './ui/modal';
import { Button } from './ui/button';
import { Notice } from './ui/states';
import ThemeSelector from './ThemeSelector';

export const NAV: [string, string][] = [
  ['/', 'Overview'],
  ['/projects', 'Projects'],
  ['/schedule', 'Schedule'],
  ['/tasks', 'Tasks'],
  ['/team', 'Team'],
  ['/materials', 'Materials & Inventory'],
  ['/budget', 'Budget & Expenses'],
  ['/documents', 'Documents'],
  ['/reports', 'Reports & Analytics'],
  ['/settings', 'Settings'],
];

export default function Layout() {
  const {
    db,
    today,
    role,
    storageError,
    notice,
    dismissNotice,
    issues,
  } = useData();

  const nav = useNavigate();
  const loc = useLocation();

  const [open, setOpen] = useState(false);
  const [bell, setBell] = useState(false);
  const [q, setQ] = useState('');

  const notes = notifications(db, today);

  useEffect(() => {
    setOpen(false);
  }, [loc.pathname]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
      }
    };

    window.addEventListener('keydown', handleKeyDown);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, []);

  return (
    <div className="flex min-h-screen flex-col md:flex-row">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:z-50 focus:bg-white focus:p-2"
      >
        Skip to content
      </a>

      {/* Mobile header */}
      <header className="flex items-center justify-between bg-navy px-3 py-2 text-white md:hidden">
        <div className="text-lg font-bold">
          Build<span className="text-accent">Space</span>
        </div>

        <button
          type="button"
          aria-expanded={open}
          aria-controls="main-nav"
          onClick={() => setOpen(!open)}
          className="rounded border border-slate-500 px-3 py-1 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
        >
          {open ? 'Close' : 'Menu'}
        </button>
      </header>

      {/* Main navigation */}
      <nav
        id="main-nav"
        aria-label="Main"
        className={cn(
          'shrink-0 flex-col gap-1 bg-navy p-2 text-slate-300 md:sticky md:top-0 md:flex md:h-screen md:w-56 md:overflow-y-auto md:p-3',
          open ? 'flex' : 'hidden',
        )}
      >
        <div className="mb-3 hidden px-2 py-1 text-lg font-bold text-white md:block">
          Build<span className="text-accent">Space</span>
        </div>

        {NAV.map(([to, label]) => (
          <NavLink
            key={to}
            to={to}
            end={to === '/'}
            className={({ isActive }: { isActive: boolean }) =>
              cn(
                'rounded px-3 py-2 text-sm hover:bg-slate-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent',
                isActive && 'bg-slate-700 text-white',
              )
            }
          >
            {label}
          </NavLink>
        ))}
      </nav>

      {/* Main content area */}
      <div className="min-w-0 flex-1">
        {/* Search, theme selector, role, and notifications */}
        <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 p-2 dark:border-slate-700">
          <form
            role="search"
            className="flex-1"
            onSubmit={(e) => {
              e.preventDefault();

              if (q.trim().length >= 2) {
                nav(`/search?q=${encodeURIComponent(q.trim())}`);
              }
            }}
          >
            <input
              type="search"
              aria-label="Search projects, tasks, team, materials, expenses and documents"
              placeholder="Search…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              className="w-full max-w-md rounded border border-slate-300 bg-transparent px-2 py-1 text-sm dark:border-slate-600"
            />
          </form>

          <ThemeSelector />

          <span className="text-xs text-slate-500">
            Role: {role}
          </span>

          <Button
            onClick={() => setBell(true)}
            aria-label={`Notifications (${notes.length})`}
          >
            🔔 {notes.length}
          </Button>
        </div>

        {/* Page content */}
        <main id="main" tabIndex={-1} className="space-y-3 p-4">
          {notice && (
            <Notice tone="warn" onClose={dismissNotice}>
              {notice}
            </Notice>
          )}

          {storageError && (
            <Notice tone="error">
              {storageError}
            </Notice>
          )}

          {issues.length > 0 && (
            <Notice tone="warn">
              Saved data needed {issues.length} repair(s). Details are in Settings → Data check.
            </Notice>
          )}

          <ErrorBoundary key={loc.pathname}>
            <Outlet />
          </ErrorBoundary>
        </main>
      </div>

      {/* Notifications dialog */}
      {bell && (
        <Modal
          title="Notifications"
          onClose={() => setBell(false)}
        >
          {notes.length ? (
            <ul className="space-y-1 text-sm">
              {notes.map((n, i) => (
                <li key={i}>
                  <NavLink
                    to={n.to}
                    onClick={() => setBell(false)}
                    className={
                      n.level === 'bad'
                        ? 'text-red-700 underline dark:text-red-400'
                        : 'underline'
                    }
                  >
                    {n.text}
                  </NavLink>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-slate-500">
              Nothing needs attention.
            </p>
          )}

          <div className="pt-3">
            <Button onClick={() => setBell(false)}>
              Close
            </Button>
          </div>
        </Modal>
      )}
    </div>
  );
}