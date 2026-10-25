import type { ReactNode } from 'react';
import { Button } from './button';
export const Err = ({ m }: { m?: string }) => (m ? <span role="alert" className="block text-xs text-red-700 dark:text-red-400">{m}</span> : null);
export const Field = ({ label, error, children }: { label: string; error?: string; children: ReactNode }) => <label className="block text-sm">{label}{children}<Err m={error} /></label>;
export const FormActions = ({ onCancel, busy, label = 'Save' }: { onCancel: () => void; busy?: boolean; label?: string }) => <div className="flex gap-2 pt-2"><Button variant="primary" type="submit" disabled={busy}>{busy ? 'Saving…' : label}</Button><Button type="button" onClick={onCancel}>Cancel</Button></div>;
export const FormError = ({ m }: { m: string }) => (m ? <div role="alert" className="rounded bg-red-100 px-2 py-1 text-sm text-red-800">{m}</div> : null);
