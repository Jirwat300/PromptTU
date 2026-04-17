const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

// The user provided project ref: xwuoptrmjscerqqpwbve
const supabaseUrl = process.env.SUPABASE_URL || 'https://xwuoptrmjscerqqpwbve.supabase.co';
const supabaseKey = process.env.SUPABASE_ANON_KEY;

let supabase = null;

if (supabaseUrl && supabaseKey) {
  supabase = createClient(supabaseUrl, supabaseKey);
  console.log('Supabase client initialized successfully.');
} else {
  console.warn('Missing SUPABASE_URL or SUPABASE_ANON_KEY. Supabase client not initialized.');
}

module.exports = supabase;
