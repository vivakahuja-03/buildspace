import type { ReactNode } from 'react';
export const Notice = ({ tone = 'info', children, onClose }: { tone?: 'info' | 'error' | 'warn'; children: ReactNode; onClose?: () => void }) => (
  <div role={tone === 'error' ? 'alert' : 'status'} className={`flex items-start gap-2 rounded px-3 py-2 text-sm ${tone === 'error' ? 'bg-red-100 text-red-900' : tone === 'warn' ? 'bg-amber-100 text-amber-900' : 'bg-sky-100 text-sky-900'}`}>
    <div className="flex-1">{children}</div>{onClose && <button type="button" aria-label="Dismiss" className="font-bold" onClick={onClose}>×</button>}
  </div>
);
export const Empty = ({ title, hint }: { title: string; hint?: string }) => <div className="rounded border border-dashed border-slate-300 p-6 text-center text-sm text-slate-500 dark:border-slate-600"><p className="font-medium">{title}</p>{hint && <p className="mt-1">{hint}</p>}</div>;
export const Loading = ({ label = 'Loading…' }: { label?: string }) => <p role="status" className="p-4 text-sm text-slate-500">{label}</p>;
