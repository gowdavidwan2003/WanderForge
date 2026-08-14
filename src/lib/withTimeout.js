/**
 * Race a promise against a deadline.
 *
 * supabase-js queues queries behind an in-flight token refresh. If that refresh
 * cannot complete — expired session, offline, refresh token rotated by another
 * tab — the query promise never settles: it does not reject, so `catch` never
 * runs and any `setLoading(false)` that lives only on the happy path is never
 * reached. The UI then spins forever with no error.
 *
 * Wrapping the call converts that silent stall into a normal rejection.
 */
export const SESSION_STALL_MESSAGE =
  'Your session may have expired — log out and back in, and close any other WanderForge tabs.';

export function withTimeout(promise, label = 'Request', ms = 15000) {
  let timer;
  const deadline = new Promise((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`${label} timed out. ${SESSION_STALL_MESSAGE}`)),
      ms
    );
  });

  return Promise.race([promise, deadline]).finally(() => clearTimeout(timer));
}
