import { Link, useSearchParams } from 'react-router-dom';
import { Card } from '../components/ui/card';
import { Table } from '../components/ui/table';
import { useData } from '../data/store';
import { searchAll } from '../lib/search';
export default function Search({ notFound }: { notFound?: boolean }) {
  const { db } = useData(), [sp] = useSearchParams(), q = sp.get('q') ?? '', hits = searchAll(db, q);
  if (notFound) return <Card><h1 className="text-xl font-semibold">Page not found</h1><Link className="text-accent underline" to="/">Go to Overview</Link></Card>;
  return <div className="space-y-3"><h1 className="text-xl font-semibold">Search</h1>{q.trim().length < 2 ? <p className="text-sm text-slate-500">Type at least 2 characters in the search box.</p> : <Card><p className="mb-2 text-sm text-slate-500">{hits.length} result(s) for “{q}”</p><Table head={['Type', 'Result']} empty="No results." rows={hits.map((h) => [h.type, <Link key="l" className="text-accent underline" to={h.to}>{h.label}</Link>])} /></Card>}</div>;
}
