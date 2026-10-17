import { ROLES } from '@erp/shared';
import { useAuth } from '../auth/AuthContext';
import { Button, Card } from '../components/ui';

/**
 * Step 1 only. Production builds show a plain notice (no sign-in exists yet). Development builds
 * add the role picker so every role's shell can be checked. Replaced by the Firebase login in Step 2.
 */
export function SignedOut() {
  const { setDevRole } = useAuth();
  return (
    <div className="mx-auto flex min-h-full max-w-md items-center p-4">
      <Card title="TVSM School ERP" subtitle="Sign-in is built in Step 2.">
        {import.meta.env.DEV ? (
          <div className="flex flex-col gap-3">
            <p className="text-sm text-ink-muted">
              Development only: pick a role to preview its navigation. The API does not trust this
              choice.
            </p>
            {ROLES.map((r) => (
              <Button key={r} variant="secondary" onClick={() => setDevRole(r)}>
                Preview as {r}
              </Button>
            ))}
          </div>
        ) : (
          <p className="text-sm text-ink-muted">Sign-in is not available yet.</p>
        )}
      </Card>
    </div>
  );
}
