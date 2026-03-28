import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export async function POST(request) {
  try {
    const { tripId, email, role = 'editor', invitedBy } = await request.json();

    if (!tripId || !email) {
      return NextResponse.json({ error: 'tripId and email are required' }, { status: 400 });
    }

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

    // Check if already a collaborator
    const { data: existing } = await supabaseAdmin
      .from('trip_collaborators')
      .select('id')
      .eq('trip_id', tripId)
      .eq('user_id', invitedUser.id)
      .limit(1);

    if (existing?.length > 0) {
      return NextResponse.json({ error: 'User is already a collaborator' }, { status: 409 });
    }

    // Add collaborator
    const { data, error } = await supabaseAdmin
      .from('trip_collaborators')
      .insert({
        trip_id: tripId,
        user_id: invitedUser.id,
        role,
        accepted: true, // Auto-accept for now
      })
      .select()
      .single();

    if (error) throw error;

    return NextResponse.json({
      success: true,
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

    await supabaseAdmin
      .from('trip_collaborators')
      .delete()
      .eq('id', collaboratorId);

    return NextResponse.json({ success: true });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
