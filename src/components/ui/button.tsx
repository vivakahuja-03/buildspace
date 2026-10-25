import { cva, type VariantProps } from 'class-variance-authority';
import type { ButtonHTMLAttributes } from 'react';
import { cn } from '../../lib/utils';
const v = cva('inline-flex items-center rounded-md px-3 py-1.5 text-sm font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-50', { variants: { variant: { primary: 'bg-accent text-slate-900 hover:brightness-95', outline: 'border border-slate-300 dark:border-slate-600 hover:bg-slate-100 dark:hover:bg-slate-800', danger: 'border border-red-300 text-red-700 hover:bg-red-50 dark:text-red-400 dark:hover:bg-slate-800' } }, defaultVariants: { variant: 'outline' } });
export function Button({ className, variant, type = 'button', ...p }: ButtonHTMLAttributes<HTMLButtonElement> & VariantProps<typeof v>) { return <button type={type} className={cn(v({ variant }), className)} {...p} />; }
