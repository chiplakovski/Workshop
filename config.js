// Supabase project connection.
//
// The "anon public" key is meant to be public — it is rate-limited and every
// table is protected by the Row Level Security policies defined in
// supabase/schema.sql, so this key alone cannot read or write data beyond
// what those policies allow. Never put the "service_role" key here or
// anywhere in this repo — that one bypasses all security rules.
//
// Fill these in following SETUP.md step 1-2.
const SUPABASE_URL = "REPLACE_WITH_YOUR_SUPABASE_PROJECT_URL";
const SUPABASE_ANON_KEY = "REPLACE_WITH_YOUR_SUPABASE_ANON_PUBLIC_KEY";
