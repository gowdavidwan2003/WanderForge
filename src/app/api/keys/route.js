import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/api/requireUser';
import { getSupabaseServerClient } from '@/lib/supabase/server';
import {
  encryptSecret,
  encryptionAvailable,
  isEncrypted,
  maskSecret,
} from '@/lib/serverCrypto';

/**
 * Storing and clearing a user's own API key.
 *
 * The profile page used to write straight to `user_api_keys` with supabase-js,
 * which meant the raw key travelled browser → PostgREST → column, in plaintext,
 * with a comment promising encryption that never happened. Encryption cannot
 * live in the browser — the key that performs it would have to be there too —
 * so the write moves here and the secret never touches the database in the clear.
 *
 * The full key is write-only from the client's perspective. It goes in, and only
 * a masked hint ever comes back.
 */

const PROVIDERS = ['groq'];

/** Rough shape check, so an obvious paste error is caught before it is stored. */
function looksLikeGroqKey(key) {
  return typeof key === 'string' && /^gsk_[A-Za-z0-9]{20,}$/.test(key.trim());
}

export async function GET() {
  const auth = await requireUser();
  if (auth.error) return auth.error;

  const supabase = await getSupabaseServerClient();
  const { data, error } = await supabase
    // Deliberately not selecting encrypted_key. Nothing on this route has a
    // reason to read it, and not selecting it is one fewer way for it to end up
    // in a log, an error payload or a response by accident.
    .from('user_api_keys')
    .select('provider, key_hint, created_at')
    .eq('user_id', auth.user.id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ keys: data ?? [] });
}

export async function POST(request) {
  const auth = await requireUser();
  if (auth.error) return auth.error;

  // Fail before touching the database. Storing the key unencrypted "for now"
  // because the secret is missing is exactly how the previous version happened.
  if (!encryptionAvailable()) {
    console.error('[WanderForge] ENCRYPTION_SECRET is missing or too short; refusing to store an API key.');
    return NextResponse.json(
      { error: 'Key storage is not configured on this server. Nothing was saved.' },
      { status: 503 }
    );
  }

  try {
    const { provider, key } = await request.json();

    if (!PROVIDERS.includes(provider)) {
      return NextResponse.json({ error: 'Unsupported provider' }, { status: 400 });
    }

    const trimmed = String(key ?? '').trim();
    if (!trimmed) {
      return NextResponse.json({ error: 'No key supplied' }, { status: 400 });
    }
    if (!looksLikeGroqKey(trimmed)) {
      return NextResponse.json(
        { error: 'That does not look like a Groq key. They begin with "gsk_".' },
        { status: 400 }
      );
    }

    const encrypted = encryptSecret(trimmed);
    // Belt and braces: if this ever stops being true, a bug has put a plaintext
    // key one INSERT away from the database.
    if (!isEncrypted(encrypted)) {
      throw new Error('Encryption produced an unexpected format');
    }

    const supabase = await getSupabaseServerClient();
    const { error } = await supabase.from('user_api_keys').upsert(
      {
        user_id: auth.user.id,
        provider,
        encrypted_key: encrypted,
        key_hint: maskSecret(trimmed),
      },
      { onConflict: 'user_id,provider' }
    );

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    return NextResponse.json({ ok: true, provider, key_hint: maskSecret(trimmed) });
  } catch (err) {
    // Never echo the request body back in an error. It contains the key.
    console.error('[WanderForge] Failed to store an API key:', err.message);
    return NextResponse.json({ error: 'Could not save the key.' }, { status: 500 });
  }
}

export async function DELETE(request) {
  const auth = await requireUser();
  if (auth.error) return auth.error;

  const provider = new URL(request.url).searchParams.get('provider');
  if (!PROVIDERS.includes(provider)) {
    return NextResponse.json({ error: 'Unsupported provider' }, { status: 400 });
  }

  const supabase = await getSupabaseServerClient();
  const { error } = await supabase
    .from('user_api_keys')
    .delete()
    .eq('user_id', auth.user.id)
    .eq('provider', provider);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
