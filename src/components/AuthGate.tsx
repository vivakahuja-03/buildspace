import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { supabase as client } from '../lib/supabase';
const supabase = client; // module-level const keeps null-narrowing inside closures via `sb` below
import { Button } from './ui/button';
import { fieldCls } from '../lib/utils';
interface Auth { user: { id: string; email: string } | null; signOut: () => Promise<void> }
const A = createContext<Auth>({ user: null, signOut: async () => undefined });
export const useAuth = (): Auth => useContext(A);
/** Demo mode (no Supabase env vars): renders the app directly. With Supabase configured, requires sign-in first. NOTE: business data is still browser-local. */
export default function AuthGate({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<{ id: string; email: string } | null>(null), [ready, setReady] = useState(!supabase);
  const [email, setEmail] = useState(''), [pw, setPw] = useState(''), [msg, setMsg] = useState(''), [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!supabase) return;
    const map = (s: { user: { id: string; email?: string } } | null | undefined) => (s ? { id: s.user.id, email: s.user.email ?? '' } : null);
    void supabase.auth.getSession().then(({ data }: { data: { session: { user: { id: string; email?: string } } | null } }) => { setSession(map(data.session)); setReady(true); });
    const { data } = supabase.auth.onAuthStateChange((_e: string, s: { user: { id: string; email?: string } } | null) => setSession(map(s)));
    return () => data.subscription.unsubscribe();
  }, []);
  if (!ready) return <p role="status" className="p-6 text-sm">Loading…</p>;
  if (supabase && !session) {
    const sb = supabase;
    const run = async (kind: 'in' | 'up' | 'reset') => {
      if (!email || (kind !== 'reset' && pw.length < 8)) { setMsg('Enter an email and a password of at least 8 characters.'); return; }
      setBusy(true); setMsg('');
      const r = kind === 'in' ? await sb.auth.signInWithPassword({ email, password: pw }) : kind === 'up' ? await sb.auth.signUp({ email, password: pw }) : await sb.auth.resetPasswordForEmail(email);
      setBusy(false);
      if (r.error) setMsg(kind === 'in' ? 'Sign-in failed. Check your email and password.' : 'Request failed. Please try again.');
      else if (kind === 'up') setMsg('Check your email to confirm your account, then sign in.'); else if (kind === 'reset') setMsg('If that account exists, a reset email has been sent.');
    };
    return (
      <main className="mx-auto mt-16 max-w-sm space-y-3 p-4"><h1 className="text-xl font-semibold">Sign in to BuildSpace</h1>
        <label className="block text-sm">Email<input type="email" autoComplete="username" className={fieldCls} value={email} onChange={(e) => setEmail(e.target.value)} /></label>
        <label className="block text-sm">Password<input type="password" autoComplete="current-password" className={fieldCls} value={pw} onChange={(e) => setPw(e.target.value)} /></label>
        {msg && <p role="alert" className="text-sm text-red-700">{msg}</p>}
        <div className="flex flex-wrap gap-2"><Button variant="primary" disabled={busy} onClick={() => void run('in')}>Sign in</Button><Button disabled={busy} onClick={() => void run('up')}>Sign up</Button><Button disabled={busy} onClick={() => void run('reset')}>Reset password</Button></div></main>
    );
  }
  return <A.Provider value={{ user: session, signOut: async () => { await supabase?.auth.signOut(); } }}>{children}</A.Provider>;
}
