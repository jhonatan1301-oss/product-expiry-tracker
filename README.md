# product-expiry-tracker

Simple product expiry tracker for a small team. It includes:

- shared PIN access (`6985`) for a simple team login
- product creation, editing and deletion
- expiry alerts for same day, 1 day, and 3 days before expiry
- mobile-first UI for browser use on phones and desktop
- realtime sync when using Supabase
- local fallback storage when Supabase is not configured

## Tech stack

- Next.js
- Supabase Realtime
- TypeScript
- CSS

## Quick setup

1. Install dependencies:

   npm install

2. Create a Supabase project and add a `products` table with the schema below.

3. Create a `.env.local` file in the project root with:

   NEXT_PUBLIC_SUPABASE_URL=your-project-url
   NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
   NEXT_PUBLIC_APP_PIN=6985

4. Run the app:

   npm run dev

## Supabase table schema

```sql
create table products (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  expiry_date date not null,
  notes text default '',
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

alter table products enable row level security;

create policy "Allow all reads and writes"
on products for all
using (true)
with check (true);
```

## Notes

- The shared PIN is set to `6985` and is checked in the app.
- Live syncing across devices works when Supabase environment variables are configured.
- Without Supabase, data is stored in the browser local storage so you can still test the UI.
