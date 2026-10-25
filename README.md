# ReviewDesk

A responsive creative review and approval app for individual designers, editors, and reviewers. Users have personal accounts with unique usernames, create their own projects, find reviewers by username or exact email, and save frequent collaborators as colleagues. Review assignments appear in the reviewer's account, while unique review links also work for people without accounts.

## Run locally

1. Install Node.js 20 or newer.
2. Run `npm install`.
3. Run `npm run dev` and open the local URL Vite prints.

Without environment variables, ReviewDesk runs in **local demo mode** with sample projects and sample accounts. Data stays in that browser and does not sync between devices. Connect Supabase and the Cloudflare upload Worker before using real accounts or client files.

## Connect Supabase

1. Create a Supabase project.
2. In the Supabase SQL editor, run the migrations in order: `0001_reviewdesk.sql`, `0002_team_reviews.sql`, `0003_organization_accounts.sql`, `0004_individual_colleagues.sql`, `0005_profile_details.sql`, then `0006_sidebar_pins_and_recents.sql`.
3. Add `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` to a local `.env` file or Cloudflare Pages environment variables.
4. Enable email and password sign-in in Supabase Auth, then add your local and deployed app URLs to its allowed redirect URLs.

The final migration converts existing organization profiles to individual accounts and makes usernames unique. It retains historical organization tables and records for data safety, but ReviewDesk no longer has organization login, department, or invitation screens. New projects belong to their individual creator. Reviewer search checks an exact username or email and returns only the person's display name and username; it never returns email addresses. Saved colleagues are private to the account that saved them.

Supabase Auth email confirmation may send its standard verification email if enabled in project settings. ReviewDesk itself does not send email, WhatsApp, or SMS notifications; project updates and reminders are in-app only.

## File uploads and deployment

Configure the Cloudflare upload Worker in `workers/` with the Supabase service role and Cloudflare R2 credentials. Add `VITE_UPLOAD_WORKER_URL` to the app's environment. See `workers/README.md` for Worker setup. Keep service-role keys out of browser variables.

Build with `npm run build`; Cloudflare Pages can deploy the generated `dist` directory. Use the included `public/_redirects` file for SPA routes.

## Stack

- React, TypeScript, Tailwind CSS, and Vite
- Supabase Auth and PostgreSQL with row-level security
- Cloudflare Pages, Workers, and R2

## Current implementation notes

Original-quality file upload, secure review links, file previews, comments, approvals, assignment status, saved colleagues, in-app notifications, retention reminders, responsive navigation, and light/dark and display-size controls are included. Some background cleanup and reminder automation requires the scheduled Worker configuration.
