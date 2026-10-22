import { Link } from 'react-router-dom';
import { Card } from '../components/ui';

const STEPS = [
  {
    to: '/data-import/students',
    title: 'Import students',
    body: 'Upload the school Excel sheet with the student list. Fees for the year are posted automatically for each new student.',
    tag: 'Step 1',
  },
  {
    to: '/data-import/old-fees',
    title: 'Import old fees',
    body: 'Upload what each student still owed before this system started (old school fees and old transport fees). Students must be imported first.',
    tag: 'Step 2',
  },
];

/** Admin: the two imports are separate jobs, so each has its own page. */
export function DataImport() {
  return (
    <div className="flex max-w-4xl flex-col gap-4">
      <div>
        <h1 className="text-2xl font-semibold text-ink">Data import</h1>
        <p className="text-sm text-ink-muted">
          Every file is checked first. Nothing is saved until you confirm.
        </p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        {STEPS.map((s) => (
          <Link key={s.to} to={s.to} className="block focus:outline-none focus-visible:ring-2">
            <Card title={s.title} subtitle={s.tag}>
              <p className="text-sm text-ink-muted">{s.body}</p>
              <p className="mt-4 text-sm font-medium text-brand">Open →</p>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}
