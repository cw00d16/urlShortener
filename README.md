# urlShortener

Serverless URL shortener with click analytics, built end-to-end on AWS with Terraform. Companion project to [chatApplication](https://github.com/cw00d16/chatApplication) — same infrastructure conventions (S3 + CloudFront frontend, Cognito auth, GitHub Actions OIDC deploy), applied to a simpler request/response workload instead of a real-time one.

## Architecture

```
React (S3 + CloudFront) ── Cognito (auth)
        │
        └── HTTP API ── Lambda (shorten, urls, redirect) ── DynamoDB
                              │
                              └── fire-and-forget ──▶ QStash ──▶ Lambda (analytics) ── DynamoDB
```

- **Frontend**: React SPA on S3, served through CloudFront (OAC, no public bucket).
- **Auth**: Cognito User Pool, JWT access token as a Bearer header on the HTTP API.
- **Shortening/lookup**: HTTP API + Lambda (`shorten`, `urls`, `redirect`) backed by a single DynamoDB table (`urls`), with a GSI for "list my links" queries.
- **Redirects**: public, unauthenticated `GET /r/{code}` — routed through CloudFront so popular links get edge-cached, but with `min_ttl=0` on that cache policy so the origin's `Cache-Control: no-cache` on the redirect response is honored, meaning every click still reaches the Lambda (needed for click tracking — see below).
- **Click analytics**: decoupled from the redirect path via [QStash](https://upstash.com/docs/qstash) (Upstash's HTTP-based message queue) — `redirect` fires an unawaited request to QStash and returns the 302 immediately; QStash retries delivery to a separate `analytics` Lambda, which verifies QStash's signature and increments the click counter.
- **CI/CD**: GitHub Actions assumes an AWS role via OIDC, deploys Lambda code and syncs the frontend build to S3 + CloudFront invalidation.

## Design decisions & tradeoffs

### Short codes: timestamp + random, not a counter

`shorten` builds each code from a 41-bit millisecond timestamp and 22 bits of crypto-random, packed into one integer and Base62-encoded (see `lambda/shorten/index.js`). The reasoning in the code comment is that this "keeps DynamoDB write distribution even over time" — worth correcting slightly: DynamoDB hashes the full partition key value to place items, so a monotonically-increasing key doesn't inherently create a hot partition here the way it would in a range-partitioned store. The random suffix is doing something more specific and more important: **guaranteeing uniqueness across concurrent Lambda invocations without any shared coordinator.** Two invocations racing in the same millisecond, in different execution environments, can't both grab "the next counter value" the way a single-threaded counter could — but they almost certainly won't roll the same 22 random bits. That's the real justification for this scheme in a serverless context, and it's a good one; the write-distribution framing just isn't quite the right reason.

### Redirects are 302, not 301 — on purpose

A 301 (permanent redirect) gets cached by the browser indefinitely — a repeat visitor's second click would never even hit your Lambda again, silently breaking click tracking for anyone who'd visited before. The code deliberately returns a 302 and sets `Cache-Control: no-cache` to keep every click flowing through the redirect Lambda. The tradeoff is the one you'd expect: a permanent redirect is the "more correct" HTTP semantic for a link that will never change destination, and it would shave a hop of latency for repeat visitors — but you'd be trading that for invisible analytics gaps, which is the wrong trade for a project whose second core feature is analytics.

### Click tracking is fire-and-forget — and that has a real reliability gap

`redirect` calls `fetch(...)` to QStash without `await`, specifically so the 302 doesn't wait on it. That's the right instinct for latency, but it runs into a genuine AWS Lambda behavior worth knowing: once a handler returns, Lambda can freeze the execution environment before an unawaited promise finishes, with no guarantee it resumes on a later invocation. In practice this usually works — the outbound request is small and typically completes before the runtime suspends — but "usually" is doing some work in that sentence, and a rare production failure mode here would be invisible (a dropped click, not a dropped redirect). Two more bulletproof options: `await` the QStash call with a short (e.g. 200ms) timeout so the response only waits a bounded amount, or swap QStash for a synchronous, AWS-native call like `SQS.SendMessage` — same fire-and-forget latency profile, but the SDK call completing is a guarantee, not a probability. Not fixed here, since QStash's cross-cloud HTTP delivery + built-in retries/signing is a reasonable and instructive choice on its own merits — just worth knowing where its edge is.

### A viral link's click counter is a hot key

`clickCount` lives as an attribute on the same item as the URL record, and every click does an `UpdateItem` against that exact item (see `lambda/analytics/index.js`). That's simple and fine at normal traffic. But DynamoDB's per-partition throughput ceiling applies per partition key regardless of how much capacity the table has overall — so one link going genuinely viral concentrates all of its clicks onto a single item, and could get throttled well before the table as a whole is anywhere near its limits. On-demand mode's adaptive capacity absorbs some of this, but not an unbounded amount. The standard fix if this ever became a real constraint: shard the counter (write each click as its own small item, e.g. keyed by `shortCode#shard`, and aggregate periodically or on read) instead of incrementing one mutable value directly.

### Local Terraform state

`main.tf`'s S3 backend block is commented out, so state lives on whichever machine last ran `terraform apply`. Fine for a solo project — but it means no locking (two concurrent `apply` runs could race) and no shared state if you ever collaborate with someone else or run Terraform from CI. The fix is standard: an S3 bucket + DynamoDB lock table for remote state, which is exactly what the commented-out block is set up for already.

### One shared IAM role for all four Lambda functions

`redirect` only ever needs `GetItem`; `shorten` only ever needs `PutItem`; but both run under the same role, which grants full CRUD on the table to every function. Simpler to manage — one role, one policy to reason about — at the cost of not being least-privilege. If one function ever had a bug or got compromised, it could take actions on the table well outside what it actually needs to do. Splitting into per-function roles (or per-function scoped policies on the shared role) is the tightening step, not built here to keep the Terraform approachable at this project's scale.

## Deploying

```
cd infrastructure
cp terraform.tfvars.example terraform.tfvars   # fill in your GitHub repo, region, and QStash keys
terraform init
terraform apply
```

You'll need a free [Upstash QStash](https://upstash.com/docs/qstash) account for `qstash_token`, `qstash_signing_key`, and `qstash_next_signing_key`.

Then copy the values from `terraform output frontend_env_vars` into `frontend/.env` (see `frontend/.env.example`) for local development — note `REACT_APP_SHORT_BASE` isn't in that output and needs to be set by hand to your CloudFront URL — or into GitHub Actions repo secrets for CI deploys:

- `AWS_ROLE_ARN` (from `terraform output github_actions_role_arn`)
- `S3_BUCKET_NAME` (from `terraform output s3_bucket_name`)
- `CLOUDFRONT_DISTRIBUTION_ID`
- `REACT_APP_API_URL`, `REACT_APP_SHORT_BASE`, `REACT_APP_COGNITO_USER_POOL`, `REACT_APP_COGNITO_CLIENT_ID`

## Local development

```
cd frontend
cp .env.example .env   # fill in terraform outputs
npm install
npm start
```
