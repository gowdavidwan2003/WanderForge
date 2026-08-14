import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getSupabaseServerClient } from '@/lib/supabase/server';

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

/**
 * This route uses the service-role key, which bypasses RLS entirely. Every handler
 * must therefore prove the caller owns the trip before touching anything — the
 * request body is attacker-controlled and cannot be trusted on its own.
 */
async function requireTripOwner(tripId) {
  const supabase = await getSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return { error: NextResponse.json({ error: 'Not authenticated' }, { status: 401 }) };
  }

  const { data: trip } = await supabaseAdmin
    .from('trips')
    .select('id, user_id')
    .eq('id', tripId)
    .single();

  if (!trip) {
    return { error: NextResponse.json({ error: 'Trip not found' }, { status: 404 }) };
  }
  if (trip.user_id !== user.id) {
    return { error: NextResponse.json({ error: 'Only the trip owner can manage collaborators' }, { status: 403 }) };
  }

  return { user, trip };
}

export async function POST(request) {
  try {
    const { tripId, email, role = 'editor' } = await request.json();

    if (!tripId || !email) {
      return NextResponse.json({ error: 'tripId and email are required' }, { status: 400 });
    }

    if (!['editor', 'viewer'].includes(role)) {
      return NextResponse.json({ error: 'role must be editor or viewer' }, { status: 400 });
    }

    const auth = await requireTripOwner(tripId);
    if (auth.error) return auth.error;

    // Find user by email
    const { data: profiles } = await supabaseAdmin
      .from('profiles')
      .select('id, email, display_name')
      .eq('email', email)
      .limit(1);

    if (!profiles || profiles.length === 0) {
      return NextResponse.json(
        { error: 'User not found. They need to sign up first.' },
        { status: 404 }
      );
    }

    const invitedUser = profiles[0];

    if (invitedUser.id === auth.user.id) {
      return NextResponse.json({ error: 'You already own this trip' }, { status: 400 });
    }

    // Check if already invited or already collaborating
    const { data: existing } = await supabaseAdmin
      .from('trip_collaborators')
      .select('id, accepted')
      .eq('trip_id', tripId)
      .eq('user_id', invitedUser.id)
      .limit(1);

    if (existing?.length > 0) {
      return NextResponse.json(
        {
          error: existing[0].accepted
            ? 'User is already a collaborator'
            : 'An invitation is already pending for this user',
        },
        { status: 409 }
      );
    }

    // Send an invitation. It stays pending until the invitee accepts — until then
    // they get no access to the trip (see is_trip_collaborator in migration 004).
    const { data, error } = await supabaseAdmin
      .from('trip_collaborators')
      .insert({
        trip_id: tripId,
        user_id: invitedUser.id,
        role,
        accepted: false,
      })
      .select()
      .single();

    if (error) throw error;

    return NextResponse.json({
      success: true,
      pending: true,
      collaborator: {
        ...data,
        display_name: invitedUser.display_name,
        email: invitedUser.email,
      },
    });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function DELETE(request) {
  try {
    const { searchParams } = new URL(request.url);
    const collaboratorId = searchParams.get('id');

    if (!collaboratorId) {
      return NextResponse.json({ error: 'Collaborator ID required' }, { status: 400 });
    }

    // Resolve which trip this row belongs to before authorising the delete.
    const { data: row } = await supabaseAdmin
      .from('trip_collaborators')
      .select('id, trip_id')
      .eq('id', collaboratorId)
      .single();

    if (!row) {
      return NextResponse.json({ error: 'Collaborator not found' }, { status: 404 });
    }

    const auth = await requireTripOwner(row.trip_id);
    if (auth.error) return auth.error;

    await supabaseAdmin
      .from('trip_collaborators')
      .delete()
      .eq('id', collaboratorId);

    return NextResponse.json({ success: true });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
