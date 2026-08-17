import ErrorScreen from '@/components/layout/ErrorScreen';

/**
 * Shown for unmatched URLs and wherever notFound() is thrown during render —
 * most importantly a trip id that does not exist or that RLS hides from the
 * current user. There is no retry here: re-fetching a missing trip will not
 * conjure one.
 */
export default function NotFound() {
  return (
    <ErrorScreen
      emoji="🗺️"
      title="No such place"
      message="We could not find this page. The trip may have been deleted, or it might belong to someone who has not shared it with you."
      homeHref="/dashboard"
      homeLabel="Back to dashboard"
    />
  );
}
