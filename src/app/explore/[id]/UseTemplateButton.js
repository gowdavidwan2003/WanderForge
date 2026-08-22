'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

import Button from '@/components/ui/Button';
import { useAuth } from '@/context/AuthProvider';
import { useToast } from '@/components/ui/Toast';
import { getSupabaseBrowserClient } from '@/lib/supabase/client';
import { withTimeout } from '@/lib/withTimeout';

/**
 * The only interactive part of the preview page.
 *
 * Split out so the page around it stays a server component: the plan must be in
 * the first HTML response for a visitor with no account, and shipping the whole
 * itinerary through a client component to get one button would defeat that.
 */
export default function UseTemplateButton({ templateId, destination }) {
  const [creating, setCreating] = useState(false);
  const router = useRouter();
  const { user } = useAuth();
  const toast = useToast();
  const supabase = getSupabaseBrowserClient();

  const handleClick = async () => {
    if (!user) {
      // Reading the plan needs no account; owning a copy does. The signup page
      // reads no return-to parameter, so none is passed — sending one would
      // promise a redirect back that never happens.
      toast.info('Sign up to save this plan as your own trip', 'Account Required');
      router.push('/auth/signup');
      return;
    }

    const startDate = new Date();
    startDate.setDate(startDate.getDate() + 14);

    setCreating(true);
    try {
      const { data: trip, error } = await withTimeout(
        supabase.rpc('create_trip_from_template', {
          p_template_id: templateId,
          p_start_date: startDate.toISOString().split('T')[0],
        }),
        'Creating your trip'
      );

      if (error) throw error;
      if (!trip?.id) throw new Error('The trip was not created. Please try again.');

      toast.success(`${destination} is on your dashboard, ready to edit.`, 'Trip Created 🎉');
      router.push(`/trip/${trip.id}`);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setCreating(false);
    }
  };

  return (
    <Button variant="primary" size="lg" onClick={handleClick} disabled={creating}>
      {creating ? 'Creating your trip…' : user ? 'Make this trip mine →' : 'Sign up to save this trip →'}
    </Button>
  );
}
