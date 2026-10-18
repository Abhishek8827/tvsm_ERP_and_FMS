import { useLocation } from 'react-router-dom';
import { NAV_ITEMS } from '@erp/shared';
import { EmptyState } from '../components/ui';
/** Honest placeholder for screens whose step has not been built (rule 2: never a dead button). */
export function ComingSoon() {
  const { pathname } = useLocation();
  const item = NAV_ITEMS.find((n) => n.path === pathname);
  return (
    <div className="max-w-3xl">
      <h1 className="mb-4 text-2xl font-semibold">{item?.label ?? 'Page'}</h1>
      <EmptyState
        title="Coming soon"
        description={
          item
            ? `This screen is built in Step ${item.availableFromStep} of the plan.`
            : 'This page does not exist.'
        }
      />
    </div>
  );
}
