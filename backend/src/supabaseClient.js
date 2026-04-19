const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

// The user provided project ref: xwuoptrmjscerqqpwbve
const supabaseUrl = process.env.SUPABASE_URL || 'https://xwuoptrmjscerqqpwbve.supabase.co';
// Server-side: prefer service role so ranking RPC + RLS never block writes (set on Vercel).
// Fallback to anon for local dev if only SUPABASE_ANON_KEY is set.
const supabaseKey =
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;

let supabase = null;

if (supabaseUrl && supabaseKey) {
  supabase = createClient(supabaseUrl, supabaseKey);
  console.log('Supabase client initialized successfully.');
} else {
  console.warn(
    'Missing SUPABASE_URL or SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY. Supabase client not initialized.',
  );
}

module.exports = supabase;
