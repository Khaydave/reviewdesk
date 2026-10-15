# ReviewDesk

A responsive creative review and approval workspace for designers and media teams. The first app slice includes the landing and auth pages, project dashboard, project CRUD flows, a reviewer portal, comments, approval actions, in-app notifications, and retention settings.

## Run locally

```bash
npm install
npm run dev
```

Without environment variables, ReviewDesk runs in **local demo mode**. Sign up with any email and a password of at least six characters. Demo projects and activity are saved in this browser. Uploaded files are previewable in the current browser session; this mode is not secure storage and should not be used for real client files.

## Supabase setup

1. Create a Supabase project and run [`supabase/migrations/0001_reviewdesk.sql`](supabase/migrations/0001_reviewdesk.sql) in its SQL editor.
2. Add the project URL and public anon key to `.env` using [`.env.example`](.env.example).
3. Enable email and password authentication in Supabase Auth. Email delivery is only used for Supabase account verification or password recovery; ReviewDesk itself sends no email, WhatsApp, or SMS notifications.
4. Set your deployed site URL and local development URL in Supabase Auth's allowed redirect URLs.

The migration creates RLS-protected user, project, file, comment, and notification tables. Guest review access is limited to token-checked RPC functions; guests do not need an account.

## Cloudflare R2 and Worker

The Worker source is in [`workers/src/index.ts`](workers/src/index.ts). It streams files into a private R2 bucket, checks the Supabase access token and project ownership for uploads, serves files only to the project owner or a reviewer with that project's unique token, and runs hourly expiry/reminder jobs. The Worker has a 95 MB per-file limit in this initial implementation.

1. Create a private R2 bucket named `reviewdesk-files` (or change `bucket_name` in `workers/wrangler.toml`).
2. In `workers/`, install and deploy with Wrangler:

   ```bash
   npm install
   npx wrangler login
   npx wrangler secret put SUPABASE_URL
   npx wrangler secret put SUPABASE_ANON_KEY
   npx wrangler secret put SUPABASE_SERVICE_ROLE_KEY
   npx wrangler deploy
   ```

3. Add the Worker URL as `VITE_UPLOAD_WORKER_URL` in the app's `.env` and Cloudflare Pages environment variables. Set `CORS_ORIGIN` to your local and deployed app origins.
4. Keep the Supabase service role key only as a Worker secret. Never put it in a `VITE_` variable.

## Cloudflare Pages

Connect the GitHub repository to Cloudflare Pages with these settings:

- Build command: `npm run build`
- Build output directory: `dist`
- Root directory: `/`
- Environment variables: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_UPLOAD_WORKER_URL`

The `public/_redirects` file routes deep links such as `/projects/:id` and `/r/:token` back to the app.

## Current implementation boundary

The demo mode supports project creation, edits, deletion, local file selection/previews, review links, comments, and approval actions without external services. When configured, Supabase auth and project/comment/notification sync are active, reviewer links use the token-checked RPCs, and uploads/downloads use the R2 Worker. Original files are previewable in the browser for images, video, and PDFs; other document formats can be downloaded. Production use requires applying the SQL migration and deploying the Worker with its secrets.

## Notifications

Notifications are in-app only. The Worker writes file expiry reminders and deletion notices into the `notifications` table; there are no email, WhatsApp, or SMS notification integrations.
