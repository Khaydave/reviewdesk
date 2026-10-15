# ReviewDesk

A responsive creative review and approval workspace for designers and media teams. It includes account-based organisation workspaces, reviewer assignments and queue counts, login-free personal review links, project management, file previews, comments, approvals, in-app notifications, and file retention settings.

## Run locally

```bash
npm install
npm run dev
```

Without environment variables, ReviewDesk runs in **local demo mode** with sample individual and organisation account views. Choose an account type on the login or sign-up screen. Demo projects and activity are saved in this browser. Invite links are for trying the flow locally and do not connect different devices. Uploaded files are previewable in the current browser session; this mode should not be used for real client files.

## Supabase setup

1. Create a Supabase project and run migrations `0001_reviewdesk.sql`, `0002_team_reviews.sql`, and `0003_organization_accounts.sql` in order in its SQL editor.
2. Add the project URL and public anon key to `.env` using [`.env.example`](.env.example).
3. Enable email and password authentication in Supabase Auth. Email delivery is only used for Supabase account verification or password recovery; ReviewDesk itself sends no email, WhatsApp, or SMS notifications.
4. Set your deployed site URL and local development URL in Supabase Auth's allowed redirect URLs.

The migrations create RLS-protected individual and organisation accounts, departments, invitation links, projects, files, assignments, comments, and notifications. Individual accounts create and review projects. An organisation login manages departments and creates shareable invitation links, then sees read-only organisation and department overviews. Invitees join as individual accounts; ReviewDesk does not send invitation emails or other messages. Project owners can assign reviewers from their organisation directory. Each assigned reviewer receives a unique token link that identifies their response and works without login. Organisation accounts cannot create projects or submit review responses.

## Cloudflare R2 and Worker

The Worker source is in [`workers/src/index.ts`](workers/src/index.ts). It streams files into a private R2 bucket, checks the Supabase access token and project ownership for uploads, serves files only to the project owner or a reviewer with a valid project or assigned-review token, and runs hourly expiry/reminder jobs. The Worker has a 95 MB per-file limit in this initial implementation.

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
