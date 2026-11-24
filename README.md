# HumanDoc

Upload a document of any size — including hundreds of pages — and HumanDoc rewrites **only the text** so it reads
naturally and human-written, while layout, formatting, images and vector graphics stay exactly the same.

Built as a production monorepo: **Next.js (App Router) + TypeScript + Tailwind + shadcn/ui**, **FastAPI** for document
processing, **PostgreSQL** (SQLAlchemy 2 + Alembic), **Redis + Celery** for background jobs, **S3-compatible storage**
with presigned multipart uploads, **Anthropic** for the rewrite model, and **Stripe** for billing.

---

## 1. Architecture

```
┌──────────────────────────── Browser ────────────────────────────┐
│  Next.js App Router (Vercel)                                    │
│  · auth / session / CSRF / billing API routes                   │
│  · server components enforce protected routes                   │
│  · SSE consumer for live progress                               │
└───────────────┬───────────────────────────────┬─────────────────┘
                │ /backend/* (rewrite, cookies   │ presigned PUT (bytes
                │ forwarded, same-origin)        │ go straight to S3)
                ▼                                ▼
┌──────────────────────────┐        ┌──────────────────────────────┐
│ FastAPI (Railway/Render) │        │ S3 / MinIO / R2              │
│ · session validation     │        │ · SSE-AES256 at rest         │
│ · upload orchestration   │        │ · signed URLs (5–15 min)     │
│ · jobs / preview / SSE   │        │ · auto-delete after N days   │
│ · admin / usage          │        └──────────────────────────────┘
└───────┬──────────┬───────┘
        │          │
        ▼          ▼
┌────────────┐  ┌───────────────────────────────────────────────┐
│ PostgreSQL │  │ Redis + Celery workers                         │
│ users      │  │ analyze → rewrite (page batches) → rebuild    │
│ sessions   │  │ → verify → upload output + QA report           │
│ jobs/pages │  │ · checkpoint per page, resumable               │
│ usage/bills│  │ · global concurrency cap + exponential backoff │
└────────────┘  └───────────────────────────────────────────────┘
                        │
                        ▼
                Anthropic Messages API (block-level)
```

**Why two backends?** Auth and billing need first-party cookies and Stripe webhooks on the web origin, so they live in
Next.js route handlers. Document processing is CPU- and memory-heavy, so it lives in FastAPI workers. The browser only
ever talks to one origin: Next.js rewrites `/backend/*` to FastAPI and forwards cookies, so the session cookie is
`SameSite=Lax` and CSRF stays simple.

---

## 2. Folder structure

```
humandoc/
├── apps/
│   ├── api/                         # FastAPI + Celery
│   │   ├── app/
│   │   │   ├── main.py
│   │   │   ├── models.py            # SQLAlchemy 2 models (source of truth)
│   │   │   ├── schemas.py           # Pydantic request/response models
│   │   │   ├── auth_deps.py         # session, CSRF, admin, rate limit
│   │   │   ├── core/                # config, db, redis, storage, security, events
│   │   │   ├── routers/             # health, uploads, jobs, admin, account
│   │   │   ├── services/            # detect, extract_*, rewrite, validators,
│   │   │   │                        # rebuild_*, verify, qa, analyze, glossary
│   │   │   └── workers/             # celery_app, tasks (checkpointed pipeline)
│   │   ├── alembic/                 # migrations
│   │   └── tests/                   # pytest + generated fixtures
│   └── web/                         # Next.js 14 App Router
│       └── src/
│           ├── app/
│           │   ├── (auth)/          # login, register, verify, forgot, reset
│           │   ├── (app)/           # dashboard, jobs, history, pricing, settings
│           │   ├── api/auth/*       # register, login, oauth, session, account
│           │   ├── api/billing/*    # checkout, portal, invoices, webhooks
│           │   ├── admin/           # admin console
│           │   └── legal/           # privacy, terms, responsible use
│           ├── components/          # app shell, upload, wizard, previews
│           │   └── ui/              # shadcn-style primitives
│           └── lib/                 # db, session, csrf, mail, auth, stripe
├── docker-compose.yml
├── Dockerfile.api · Dockerfile.web
├── .env.example
└── .github/workflows/ci.yml
```

---

## 3. Database schema

All tables use UUID primary keys and `timestamptz`. `app/models.py` is the source of truth; the initial Alembic
migration materialises that metadata.

| Table | Purpose / key columns |
|---|---|
| `users` | `email` (unique via lower index), `password_hash` (bcrypt), `role` (`user`\|`admin`), `email_verified_at`, `failed_login_count`, `locked_until`, `deleted_at` |
| `sessions` | `token_hash` (sha256 of opaque token), `csrf_token`, `expires_at`, `revoked_at`, `user_agent`, `ip` |
| `email_verification_tokens` | `token_hash`, `expires_at` (60 min), `used_at` |
| `password_reset_tokens` | `token_hash`, `expires_at` (30 min), `used_at` |
| `oauth_accounts` | `provider`, `provider_account_id`, unique pair |
| `uploads` | `key`, `filename`, `size`, `mime`, `status`, `s3_upload_id`, `parts` (JSONB), `etag`, `expires_at` |
| `jobs` | `status`, `source_key`, `output_key`, `qa_key`, `file_kind`, `total_pages`, `processed_pages`, `total_blocks`, `flagged_blocks`, `tokens_in/out`, `cost_usd`, `options` (JSONB), `analysis` (JSONB), `error`, `expires_at` |
| `job_pages` | `job_id`, `page_number` (unique pair), `status`, `blocks` (JSONB), `notes` — **the checkpoint table** |
| `usage_records` | `user_id`, `period` (`YYYY-MM`), `pages`, `words`, `tokens` |
| `subscriptions` | `stripe_customer_id`, `stripe_subscription_id`, `tier`, `status`, `pages_per_month`, `current_period_end`, `cancel_at_period_end` |
| `invoices` | `stripe_invoice_id`, `amount` (cents), `currency`, `status`, `hosted_url`, `pdf_url` |
| `audit_logs` | `user_id`, `action`, `meta` (JSONB), `ip`, `created_at` |

**Job states:** `queued → analyzing → analyzed → rewriting → rebuilding → verifying → done | failed | canceled`.

---

## 4. API

### FastAPI (`/backend/*` through the Next.js proxy)

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/health` | — | liveness |
| GET | `/ready` | — | DB + Redis checks |
| GET | `/config` | — | public limits and tiers |
| POST | `/uploads/init` | user | start multipart upload, returns presigned part URLs |
| POST | `/uploads/{id}/complete` | user | complete multipart, verify size, optional virus scan |
| GET | `/uploads/{id}` | user | upload status |
| DELETE | `/uploads/{id}` | user | abort multipart / delete object |
| POST | `/jobs` | user | create job from a completed upload, enqueue analysis |
| GET | `/jobs` | user | list jobs (limit/offset) |
| GET | `/jobs/usage` | user | period usage and entitlement |
| GET | `/jobs/{id}` | user | job detail + page checkpoints |
| POST | `/jobs/{id}/start` | user | quota check, dispatch rewrite batches |
| POST | `/jobs/{id}/resume` | user | re-dispatch only unfinished pages |
| POST | `/jobs/{id}/cancel` | user | cancel before processing starts |
| DELETE | `/jobs/{id}` | user | delete file, output, QA and row |
| PATCH | `/jobs/{id}/locks` | user | lock/unlock blocks by id (pre-start) |
| GET | `/jobs/{id}/preview/{page}` | user | blocks with original + rewritten text, bbox, font |
| GET | `/jobs/{id}/download` | user | presigned download URL |
| GET | `/jobs/{id}/qa` | user | presigned QA report URL |
| GET | `/jobs/{id}/stream` | user | **SSE** progress: snapshot, page events, done/error |
| DELETE | `/account` | user | delete all objects + account (cascade) |
| GET | `/admin/stats` | admin | users, jobs, pages, tokens |
| GET | `/admin/users` | admin | users + usage |
| PATCH | `/admin/users/{id}` | admin | role / name |
| DELETE | `/admin/users/{id}` | admin | delete user and data |
| GET | `/admin/jobs` | admin | all jobs |
| GET | `/admin/audit` | admin | audit log |

### Next.js route handlers

| Method | Path | Description |
|---|---|---|
| POST | `/api/auth/register` | validate, hash, create verification token, email link |
| POST | `/api/auth/login` | lockout after 5 failures, httpOnly session + CSRF cookies |
| POST | `/api/auth/logout` | revoke session, clear cookies |
| GET | `/api/auth/me` | current user |
| GET | `/api/auth/verify?token=` | consume token, sign in, redirect |
| POST | `/api/auth/resend` | resend verification |
| POST | `/api/auth/forgot` | always 200, emails reset link if the account exists |
| POST | `/api/auth/reset` | token + new password, revokes all sessions |
| PATCH | `/api/auth/profile` | update name |
| PATCH | `/api/auth/password` | change password, revoke other sessions |
| DELETE | `/api/auth/account` | delete account + all data |
| GET | `/api/billing/usage` | tier + page usage |
| POST | `/api/billing/checkout` | Stripe Checkout |
| POST | `/api/billing/portal` | Stripe billing portal |
| POST | `/api/billing/cancel` | cancel at period end |
| GET | `/api/billing/invoices` | stored invoices |
| POST | `/api/billing/webhooks` | signature-verified Stripe webhooks |

---

## 5. The core pipeline

### a) Analyse
File type is **sniffed from bytes** (never the extension). PDF structure is read with PyMuPDF (`page.get_text("dict")`):
blocks → lines → spans with bbox, font, size, colour and flags. `page.find_tables()` marks table cells. Blocks are
classified (heading, paragraph, list item, caption, header/footer, page number, table cell, equation, code, URL,
citation) and classified skip regions are marked before any model call. Two-column pages are detected and read in
column order. A pre-job report (pages, words, languages, fonts, selectability, OCR requirement, cost estimate) is
stored on the job and shown to the user.

### b) Rewrite
Each block is sent **individually** with: previous block, next block, section heading, the document glossary, a style
profile and strength/tone/language settings. The system prompt contains hard constraints (same meaning/facts/numbers/
names/citations, ±10% length, same language, JSON only) plus the humanising rules (vary sentence length, no triads, no
stock phrases, no invented facts, no em-dash abuse).

Every response is validated deterministically:
- length ratio inside ±10% (wider for very short blocks)
- every number, date, email, URL, DOI and acronym preserved
- proper nouns preserved
- no stock AI phrases
- no script/language drift

Failures are retried with a corrective prompt (2 retries), then the **original text is kept and the block flagged**.
API rate limits get exponential backoff (up to 5 attempts). A `TerminologyMemory` in Redis keeps acronyms and product
names identical across every page.

### c) Rebuild
- **PDF:** redaction annotations are added over *only* the rewritten text boxes, then applied with
  `images=PDF_REDACT_IMAGE_NONE, graphics=PDF_REDACT_LINE_ART_NONE` — images and vector art are untouched. New text is
  inserted into the same bbox, reusing the embedded font when extractable, otherwise the closest base-14 face with the
  same size, colour and alignment. Overflow → font shrink to 96%, then 92% (8% max), then the model is asked for a
  shorter version; if it still won't fit, the original text is restored and flagged.
- **DOCX/PPTX:** text is distributed across the *existing runs* proportionally to their original lengths, so bold,
  italic, hyperlinks, styles, numbering, tables and images stay intact. The package is edited, never rebuilt.
- **TXT/MD:** exact-substring replacement so code fences, front matter and inline syntax survive.

### d) Verify
Page count, per-page image SHA-256 fingerprints, page geometry, rotation, vector drawing counts and embedded fonts are
compared before vs after. The QA report lists flagged blocks, skipped regions, overflow fixes and verification issues.

### Scale & resilience
- Pages are split into batches (default 5) and dispatched as a Celery group with a chord finaliser.
- **Every page is checkpointed** to `job_pages` immediately after rewriting.
- A `resume` endpoint re-dispatches only pages whose status is not `rewritten` — never from zero.
- A beat task sweeps jobs stuck >30 min and marks them resumable.
- Progress is published to Redis pub/sub and streamed over SSE (`page X of N`, ETA, current section).
- Uploads use S3 multipart with 20 MB parts (500 MB cap = 25 parts) and per-part retry.
- Every LLM call respects `llm_max_concurrency` and a token budget; worker concurrency is configurable.

---

## 6. Quick start

```bash
cp .env.example .env
# fill in: SESSION_SECRET, FIELD_ENCRYPTION_KEY, ANTHROPIC_API_KEY, STRIPE_*, RESEND_API_KEY

docker compose up --build
# web    http://localhost:3000
# api    http://localhost:8000/docs
# minio  http://localhost:9001 (minioadmin / minioadmin)
```

Local development without Docker:

```bash
# 1. Postgres + Redis + MinIO
docker compose up -d db redis minio createbucket
# 2. Python
cd apps/api && python -m venv .venv && source .venv/bin/activate
pip install -e ".[dev]"
alembic upgrade head
uvicorn app.main:app --reload --port 8000
# 3. Worker
celery -A app.workers.celery_app worker -l info -Q humandoc -c 2
# 4. Web
npm install
npm run dev
```

**MinIO CORS** — the browser PUTs directly to presigned URLs, so the bucket must allow it:

```bash
mc alias set local http://localhost:9000 minioadmin minioadmin
mc cors import local/humandoc < cors.json
```

```json
[
  {
    "allowedOrigins": ["http://localhost:3000"],
    "allowedMethods": ["GET", "PUT", "POST"],
    "allowedHeaders": ["*"],
    "exposeHeaders": ["ETag"],
    "maxAgeSeconds": 3000
  }
]
```

On AWS S3 add the equivalent bucket CORS policy. `ETag` **must** be exposed — multipart completion needs it.

---

## 7. Configuration

See `.env.example` for every variable. The critical ones:

| Variable | Notes |
|---|---|
| `SESSION_SECRET`, `FIELD_ENCRYPTION_KEY` | `openssl rand -hex 32`, different values |
| `ANTHROPIC_MODEL` | model name, e.g. `claude-sonnet-4-5` |
| `ANTHROPIC_MAX_RETRIES` | validation retries per block (default 2) |
| `LLM_MAX_CONCURRENCY` | global semaphore for model calls |
| `BATCH_SIZE` | pages per worker task |
| `RETENTION_DAYS` | auto-delete window (default 7) |
| `MAX_UPLOAD_MB` / `UPLOAD_PART_MB` | 500 / 20 |
| `PRICE_PER_1M_TOKENS` | used for the pre-job cost estimate |
| `VIRUS_SCAN_ENABLED` + `CLAMAV_HOST` | ClamAV INSTREAM scan hook |
| `TIER_*_PAGES` | quota per plan |

---

## 8. Security & privacy

- **Passwords:** bcrypt cost 12, never logged, never returned.
- **Sessions:** opaque 256-bit tokens, only SHA-256 stored, httpOnly + `SameSite=Lax`, revocable, expiry checked per request.
- **CSRF:** double-submit token (non-httpOnly cookie + `x-csrf-token` header), checked on every mutating request in both Next and FastAPI.
- **Brute force:** 5 failures → 15-minute lockout, per-IP throttle on top, generic error messages, audit log entries.
- **Email enumeration:** registration and password reset responses are intentionally uniform.
- **Files:** S3 SSE-AES256, per-user key prefixes, presigned URLs (5–15 min), auto-delete after `RETENTION_DAYS`, immediate "delete now".
- **Isolation:** every query filters by `user_id`; admin endpoints require the `admin` role.
- **Input:** byte-sniffed file type, size limits, Pydantic validation, per-user rate limiting, security headers.
- **Virus scan:** ClamAV INSTREAM hook, enabled with `VIRUS_SCAN_ENABLED=true`.
- **No training:** documents are never used to train models; stated in the UI, privacy policy and README.
- **Responsible use:** the app states that users must follow their institution's AI policy and disclose assistance; it explicitly does not promise detector evasion.

---

## 9. Testing

```bash
cd apps/api && pytest -q          # extraction, rebuild, validators, scale, office formats
cd apps/web && npm test           # auth/validation logic (vitest)
```

Python tests generate their own fixtures (5-page PDF, 100-page PDF, PDF with images + table, DOCX with real styles,
PPTX) via `tests/make_fixtures.py`, so no binaries are committed. They assert page count, image fingerprints, vector
line survival, style preservation, validator behaviour and 100-page scale.

CI (`.github/workflows/ci.yml`) runs ruff + pytest for the API and lint + typecheck + vitest for the web app.

---

## 10. Deployment

**Vercel (web)**
- Build command `npm run build`, output `apps/web`.
- Set `API_INTERNAL_URL` to the FastAPI public URL, `DATABASE_URL_PG`, `REDIS_URL`, and all auth/billing secrets.
- The rewrite in `next.config.mjs` proxies `/backend/*` to FastAPI.

**Railway / Render (API + worker)**
- Two services from `Dockerfile.api`: `api` runs `uvicorn`, `worker` runs the Celery command from `docker-compose.yml`.
- Attach Postgres and Redis, run `alembic upgrade head` on release.
- Set `S3_*` to S3/R2/MinIO and add the bucket CORS policy.

**Storage lifecycle:** objects are tagged with `delete-at`; the Celery beat `purge_expired_files` task deletes expired
objects hourly, and the UI shows the exact expiry per job.

---

## 11. Known limitations

- **PDF text fidelity:** rewritten text is inserted into the original bbox with the same font, size, colour and
  alignment, but character-level justification and exact line breaks are not guaranteed. Very tight boxes may shrink
  the font by up to 8%.
- **Scanned PDFs:** OCR (Tesseract) rasterises the page and overlays invisible text, so the rewrite is inserted over
  the scan image. Quality depends on the scan.
- **Complex PDF structures:** text inside form fields, annotations, or highly overlapping multi-column layouts may be
  skipped rather than risk breaking the layout.
- **DOCX/PPTX:** paragraphs whose text lives entirely inside content controls, footnotes or tracked-change revisions may
  be copied through unchanged.
- **Equations:** detected by font heuristics and symbol density; unusual math fonts may be treated as prose.
- **Email** requires `RESEND_API_KEY`; in development without a key, messages are printed to the server log.
- **Stripe** requires price IDs for the three paid tiers and a webhook secret.
- **The model can still produce a bad sentence.** Validators catch structural and factual slips, not tone. Review the
  QA report and the document before publishing.
