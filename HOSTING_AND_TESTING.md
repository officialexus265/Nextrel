# Kestrel — Beginner Hosting & Testing Guide

This guide follows the System Blueprint (Vercel + Neon + Cloudflare R2, ~$200/year ceiling).  
You do **not** need to be a DevOps expert. Follow the steps in order.

---

## What you are deploying

| Piece | What it does | Blueprint target |
|-------|----------------|------------------|
| **App (frontend + API)** | React app (TanStack Start / Vite) | Vercel (Hobby free tier is fine to start) |
| **Database** | Postgres for vehicles, positions, users, alerts | Neon (serverless Postgres) |
| **Media files** | Dashcam snapshots, documents, exports | Cloudflare R2 |
| **Maps** | Live map tiles | Leaflet + OpenStreetMap (free, no key) |
| **Email (optional)** | Alert / report emails | Resend or similar free tier |

Locally the app can run with an embedded database (PGLite) so you can develop without Neon.

---

## 1. Prerequisites (one-time)

1. **Node.js 20+**  
   - Check: `node -v`  
   - Install from https://nodejs.org if needed.

2. **Git** (to push to GitHub / Vercel).

3. Accounts (all have free tiers):
   - [GitHub](https://github.com)
   - [Vercel](https://vercel.com) (sign in with GitHub)
   - [Neon](https://neon.tech)
   - [Cloudflare](https://dash.cloudflare.com) (for R2)

---

## 2. Run locally first (test before hosting)

```bash
# From the project folder
npm install
npm run dev
```

Open **http://localhost:8080**

### What to test locally

1. **Landing page**  
   - Clean professional hero (headline + “Enter console”).  
   - No instructional feature cards.

2. **Company login** — `/login`  
   - Create an account (first user becomes **Super Admin**).  
   - Sign out, create a second account → it should land as **pending** until invited.

3. **Platform owner login** — `/platform`  
   - Use the Super Admin email/password.  
   - A non-owner account that signs in here should be **denied** and signed out.

4. **Ops console** — `/ops`  
   - Live map, companies (Platform menu), create a company, invite a field admin.

5. **Landing media (Super Admin)**  
   - Go to **Platform → Landing page** section.  
   - Set media type to Image or Video, paste a public URL (e.g. a JPG or MP4 on R2 or any CDN).  
   - Save, open `/` in a private window → hero should show.

6. **Roles**  
   - As Super Admin use “View as” (if available) or invite users with roles:  
     `company_admin`, `tracker`, `accounts`, `field_admin`.

---

## 3. Database: Neon (production)

1. Create a project in Neon → copy the **connection string**  
   (looks like `postgresql://user:pass@ep-....neon.tech/neondb?sslmode=require`).

2. You will put this in Vercel as an environment variable (next section).

3. Migrations run automatically on `npm run build` / deploy via `npm run db:migrate`.  
   Ensure the app can reach Neon (SSL is already in the URL).

---

## 4. Media: Cloudflare R2 (optional at start)

1. Cloudflare Dashboard → **R2** → Create bucket (e.g. `kestrel-media`).
2. Create an API token with Object Read & Write for that bucket.
3. Note: Account ID, Access Key ID, Secret Access Key, Bucket name, public URL (if you enable public access or use a custom domain).

For the **landing hero**, you can paste any public image/video URL.  
Later, wire the app’s media upload path to R2 (S3-compatible) using those credentials.

---

## 5. Deploy to Vercel

1. Push this project to a **GitHub repository**.
2. In Vercel → **Add New Project** → Import the repo.
3. Framework preset: leave as detected (Vite / other).  
   Build command should be similar to:  
   `npm run build`  
   Output: whatever the Vite/Nitro build produces (Vercel usually detects it).
4. **Environment variables** (Project → Settings → Environment Variables):

   | Name | Example / notes |
   |------|------------------|
   | `DATABASE_URL` | Neon connection string |
   | `BETTER_AUTH_SECRET` | Long random string (e.g. `openssl rand -hex 32`) |
   | `BETTER_AUTH_URL` | Your production URL, e.g. `https://kestrel.vercel.app` |
   | Auth provider keys | Only if you enable Google/GitHub etc. |
   | R2 vars (later) | `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET` |

5. Deploy. After the first deploy succeeds:
   - Open the site URL.
   - Sign up the **first** user → becomes Super Admin.
   - Configure landing media under Platform.
   - Create a company and invite real users.

---

## 6. Security checklist (aligned with the blueprint)

| Control | Status / action |
|---------|------------------|
| Multi-tenant isolation (`company_id` on queries) | Implemented in server functions |
| Role checks on sensitive APIs | Implemented (`super_admin`, `company_admin`, …) |
| Super Admin vs impersonation (`realRole`) | Implemented |
| Separate owner entry (`/platform`) | Implemented — not linked from public site |
| Public sign-up creates **pending** users only | Implemented |
| Password hashing | Handled by better-auth (modern algorithms) |
| HTTPS | Automatic on Vercel |
| Rate limiting on `/api/ingest` | Recommended for production (add edge rate limit) |
| Optional 2FA for Super Admin / Company Admins | Blueprint recommends; can be enabled in auth config later |
| Force logout / session management | Blueprint capability; available via Super Admin tools |
| No SMS / WhatsApp alerts | Out of scope by design |

**Recommendations for production:**

- Prefer **invite-only** for company users (disable open sign-up if you expose the app publicly).
- Keep Super Admin password long and unique; only use `/platform` yourself.
- Do not commit `.env` or secrets; use Vercel env vars only.
- Restrict who knows the `/platform` URL (security through obscurity is **not** enough alone — role checks enforce it).

---

## 7. Quick test script after deploy

1. Open production URL → landing looks professional, no instructional blocks.  
2. `/login` → create company user (or use invite).  
3. `/platform` → Super Admin only.  
4. Create company → assign devices/vehicles (Field Admin flow).  
5. As Tracker: see live map, status colours, acknowledge an alert.  
6. Set a landing image/video URL → confirm public homepage updates.  
7. Confirm company A data is invisible when logged in as company B.

---

## 8. Cost reminder (Blueprint §10)

- Vercel Hobby + Neon free tier + R2 free storage can run early stage at **$0**.  
- Stay under ~**$200/year** for 150–300 vehicles by monitoring Neon compute and R2 usage.  
- Maps (OSM) and basic email free tiers keep the bill low.

---

## Troubleshooting

| Problem | What to try |
|---------|-------------|
| Blank page / build fail | Check Vercel build logs; ensure `npm run build` works locally |
| DB errors | Confirm `DATABASE_URL` and that migrations ran |
| Always “pending” | Super Admin must invite that email with a role |
| Landing media not showing | URL must be publicly reachable (HTTPS); check type = image/video |
| `/platform` denies you | Account is not `super_admin` (only the first user or an explicitly promoted owner) |

Document generated to match the Vehicle Tracking & Fleet Management Platform blueprint (15 Sep 2026).
