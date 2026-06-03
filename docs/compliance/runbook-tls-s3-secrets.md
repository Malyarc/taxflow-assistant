# Operational Runbooks — TLS Termination, Document Storage (S3 + SSE-KMS), Secrets Management

**Status:** Working draft for execution. Infra-side P0 remediation.
**Owner:** [BRACKETS — name of the engineer executing] / Qualified Individual: [BRACKETS — WISP-designated QI]
**Last updated:** 2026-06-03
**Maps to:** P0-4 (Auth + TLS), P0-5 (Encrypt PII at rest — document blobs), P0-1 (rotate leaked creds → move to managed secret store). See `docs/product-assessment-2026-06-02.md` and `docs/compliance/` WISP.

---

## Why these three runbooks exist (regulatory frame)

TaxFlow is a tax preparer's tool. Under the **FTC Safeguards Rule (16 CFR Part 314, implementing the Gramm-Leach-Bliley Act)**, tax preparers are "financial institutions" and the firm using TaxFlow must maintain a Written Information Security Program (WISP). Full compliance was required by **2023-06-09**. The Rule mandates, among other safeguards:

- **§314.4(c)(3): Encryption of customer information in transit and at rest** — or written compensating controls reviewed and approved in writing by the Qualified Individual. Runbook A (TLS, in transit) and Runbook B (S3 SSE-KMS, at rest for documents) close this for the document-blob path.
- **§314.4(c)(1)/(2): Access controls and authentication, including MFA (§314.4(c)(5))** — Runbook A Option 1 (Cloudflare Access) is the fastest way to put an authenticated, MFA-capable front door on all 79 currently-unauthenticated endpoints while the in-app auth (D15) is built.
- **§314.4(c)(6): Secure disposal** and **§314.4(c)(4): inventory/where customer data lives** — Runbook B moves plaintext base64 PII out of the Postgres row into an access-controlled, encrypted, auditable object store with lifecycle/disposal policy.
- **§314.4(e): Change management** and **§314.4(b): risk assessment** — Runbook C (secrets out of pm2 env into SSM/Secrets Manager with rotation) removes long-lived plaintext credentials from the process environment.

Current reality this remediates (all live on `ec2-18-188-192-154` in `us-east-2`):

- Express serves **cleartext HTTP on :8080, port 443 closed, no TLS** → Runbook A.
- Tax documents stored as **base64 plaintext in `tax_documents.file_content`**; SSN/TIN in plaintext text columns → Runbook B (documents). *(Field-level SSN/TIN encryption via pgcrypto/KMS envelope is a separate P0-5 work item — out of scope for this infra runbook, tracked in the WISP encryption plan.)*
- **Neon `DATABASE_URL` + Gemini `AI_API_KEY` baked into the pm2 process env**, both leaked and (per the P0 batch) being rotated → Runbook C.

> **[LEGAL REVIEW]** These runbooks are the *operational* half of P0. They do not, by themselves, satisfy §7216/§6713 (the criminal/civil consent requirement for sending taxpayer return information to Google Gemini — that is P0-2, a separate signed-consent-flow + Google DPA work item). Do not treat "TLS + encrypted storage shipped" as "we may now process real client PII." The §7216 consent flow and the WISP sign-off gate that.

---

## Conventions used in every runbook

```bash
# Region + instance are fixed for this project.
export AWS_REGION=us-east-2
export AWS_DEFAULT_REGION=us-east-2
export EC2_HOST=ec2-18-188-192-154.us-east-2.compute.amazonaws.com
export SSH="ssh -i ~/Downloads/taxflow-key.pem ubuntu@${EC2_HOST}"
# Account id (used to build ARNs). Capture once:
export AWS_ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
echo "Account: ${AWS_ACCOUNT_ID}  Region: ${AWS_REGION}"
```

- The app lives at `~/taxflow-pro` **on the box** (not `taxflow-assistant`). The api-server runs from `~/taxflow-pro/artifacts/api-server/dist/index.mjs` under **pm2 process name `taxflow`** (`pm2 id` is `0`).
- The instance has **908 MiB RAM** — never build the Vite frontend on it (OOM/exit 137). Build locally, rsync `artifacts/tax-app/dist/public/`.
- Run `aws` commands from **your laptop** (which has AWS credentials), unless a step explicitly says "on the box." Steps that must run on the box are prefixed `# [ON BOX]`.

---

# Runbook A — TLS Termination

**Goal:** Stop serving cleartext. Get HTTPS responding on **:443** in front of the Express app on `127.0.0.1:8080`, then flip the app.ts security toggles that are currently disabled because port 443 is closed.

Three options, **ranked by speed to a working HTTPS front door**. Pick one. Option 1 is the recommended front door because it also delivers MFA-capable auth (P0-4's "Auth" half) the same afternoon.

| Option | Time to HTTPS | Also gives auth (P0-4)? | Notes |
|---|---|---|---|
| **1. Cloudflare proxy + Access** | ~1–2 hrs | **Yes** — Zero-Trust Access policy = MFA in front of all 79 endpoints | Recommended. Needs the domain's DNS on Cloudflare. |
| **2. AWS ALB + ACM cert** | ~2–4 hrs | No (add Cognito/OIDC on the ALB later) | Native AWS, integrates with the existing EC2/VPC. Costs ~$16/mo for the ALB. |
| **3. nginx + certbot on the box** | ~1–2 hrs | No | Cheapest, single box. You own renewal + the 908 MiB RAM headroom. |

> **Prereq common to all three:** you must have a DNS name to put the cert on. TaxFlow is currently reached by raw EC2 DNS, which **cannot** get a public CA cert. Decide the hostname now, e.g. `app.taxflow.[BRACKETS-domain]`. The rest assumes `APP_HOST=app.taxflow.[BRACKETS-domain]`.

```bash
export APP_HOST=app.taxflow.[BRACKETS-domain]
```

---

## Option 1 — Cloudflare in front (recommended)

Cloudflare terminates TLS at its edge (browser↔Cloudflare), then connects to your origin. With an **Origin Certificate** on the box and **Full (Strict)** mode, the Cloudflare↔origin hop is also encrypted and authenticated. Cloudflare Access adds an identity gate (Google/GitHub/OTP, with MFA) over every request — the fastest path to satisfying P0-4's auth requirement without building in-app auth first.

### Prerequisites
- The domain `[BRACKETS-domain]` is using Cloudflare nameservers (added as a zone in the Cloudflare dashboard).
- A Cloudflare account with the zone. API token with `Zone:DNS:Edit` + `Access:Edit` if scripting; the dashboard is fine for a one-time setup.
- Security group on the EC2 instance allows inbound **443** from Cloudflare IP ranges (and you will *close* 8080 to the public — see hardening step).

### Steps

**1. Point DNS at the box, proxied (orange cloud).**
Dashboard → DNS → Add record:
- Type `A`, Name `app.taxflow` (or `@`/subdomain), Content = the EC2 **public IP** (`dig +short ${EC2_HOST}`), **Proxy status: Proxied**.

**2. Install a Cloudflare Origin Certificate on the box** (so Cloudflare↔origin is encrypted; required for Full (Strict)).
Dashboard → SSL/TLS → Origin Server → Create Certificate (RSA, hostnames `app.taxflow.[BRACKETS-domain]`). Copy the cert + key, then on the box:

```bash
# [ON BOX]
sudo mkdir -p /etc/ssl/cloudflare
sudo tee /etc/ssl/cloudflare/origin.pem >/dev/null   # paste the Origin Certificate
sudo tee /etc/ssl/cloudflare/origin.key >/dev/null    # paste the Private Key
sudo chmod 600 /etc/ssl/cloudflare/origin.key
```

**3. Put a thin TLS reverse proxy on the box listening on 443 → 127.0.0.1:8080.** The simplest is nginx with the origin cert (no certbot needed — Cloudflare issued the cert):

```bash
# [ON BOX]
sudo apt-get update && sudo apt-get install -y nginx
sudo tee /etc/nginx/sites-available/taxflow >/dev/null <<'NGINX'
server {
    listen 443 ssl;
    listen [::]:443 ssl;
    server_name app.taxflow.[BRACKETS-domain];

    ssl_certificate     /etc/ssl/cloudflare/origin.pem;
    ssl_certificate_key /etc/ssl/cloudflare/origin.key;

    client_max_body_size 25m;   # match Express 20mb body + base64 overhead

    location / {
        proxy_pass http://127.0.0.1:8080;
        proxy_set_header Host              $host;
        proxy_set_header X-Real-IP         $remote_addr;
        proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto https;
        proxy_read_timeout 120s;
    }
}
NGINX
sudo sed -i 's/\[BRACKETS-domain\]/[BRACKETS-domain]/g' /etc/nginx/sites-available/taxflow   # or hand-edit
sudo ln -sf /etc/nginx/sites-available/taxflow /etc/nginx/sites-enabled/taxflow
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t && sudo systemctl reload nginx
```

**4. Set SSL/TLS encryption mode to Full (Strict).**
Dashboard → SSL/TLS → Overview → **Full (strict)**. This forces Cloudflare to validate the origin cert (which it issued), so the whole chain is encrypted end-to-end.

**5. Add a Cloudflare Access policy (this is the auth half of P0-4).**
Zero Trust dashboard → Access → Applications → Add a **Self-hosted** application:
- Application domain: `app.taxflow.[BRACKETS-domain]`
- Session duration: e.g. 8h
- Add a **policy**: Action `Allow`, Include → **Emails ending in** `@[BRACKETS-firm-domain]` (or explicit Emails list of the CPAs). Add an identity provider (Google / One-time PIN) under Settings → Authentication — OTP-over-email gives you MFA-equivalent assurance immediately; Google/Okta give true MFA.

Optionally bypass Access for the health check so uptime monitors work:
- Second policy, Action `Bypass`, Include → everyone, but scope the application path to `/api/healthz` (create a second Access app for just that path, or use a Bypass policy with a path).

**6. Harden: stop the public internet from reaching :8080 directly** (otherwise Access is trivially bypassed by hitting the raw EC2 IP). In the EC2 security group, **remove the 0.0.0.0/0 rule on 8080**; allow 8080 only from `127.0.0.1` usage (nginx is local) and 443 only from [Cloudflare IP ranges](https://www.cloudflare.com/ips/):

```bash
# Find the SG id:
aws ec2 describe-instances \
  --filters "Name=dns-name,Values=${EC2_HOST}" \
  --query "Reservations[].Instances[].SecurityGroups[].GroupId" --output text
export SG_ID=[BRACKETS-sg-id]

# Remove public 8080 (adjust to the actual existing rule):
aws ec2 revoke-security-group-ingress --group-id "$SG_ID" \
  --protocol tcp --port 8080 --cidr 0.0.0.0/0

# Allow 443 from Cloudflare ranges (repeat per CIDR from cloudflare.com/ips):
for CIDR in 173.245.48.0/20 103.21.244.0/22 103.22.200.0/22 103.31.4.0/22 \
            141.101.64.0/18 108.162.192.0/18 190.93.240.0/20 188.114.96.0/20 \
            197.234.240.0/22 198.41.128.0/17 162.158.0.0/15 104.16.0.0/13 \
            104.24.0.0/14 172.64.0.0/13 131.0.72.0/22; do
  aws ec2 authorize-security-group-ingress --group-id "$SG_ID" \
    --protocol tcp --port 443 --cidr "$CIDR" 2>/dev/null
done
```

Then proceed to **[App toggles to re-enable TLS-only behavior]** below.

### Verification
```bash
# HTTPS resolves and the health endpoint answers via Cloudflare:
curl -sS https://${APP_HOST}/api/healthz ; echo
# An unauthenticated app request is intercepted by Access (302 to the login):
curl -sSI https://${APP_HOST}/api/clients | grep -i -E "location|cf-access|HTTP/"
# Direct :8080 from the public internet should now FAIL (timeout/refused):
curl -m 5 -sS http://${EC2_HOST}:8080/api/healthz || echo "GOOD: :8080 not publicly reachable"
```

### Rollback
- In Cloudflare DNS, switch the record to **DNS only** (grey cloud) to take the edge out of the path, or delete the Access application to drop the auth gate.
- On the box: `sudo systemctl stop nginx`. Re-add the 8080 public SG rule only if you must temporarily restore the old cleartext path (not recommended): `aws ec2 authorize-security-group-ingress --group-id "$SG_ID" --protocol tcp --port 8080 --cidr 0.0.0.0/0`.
- Revert the app.ts toggles (see that section's rollback).

---

## Option 2 — AWS ALB + ACM certificate

An Application Load Balancer terminates TLS (ACM cert) on :443 and forwards to a target group pointing at the EC2 instance on :8080. Native to the existing VPC; no software on the box.

### Prerequisites
- The instance's VPC has **at least two public subnets in different AZs** (ALB requirement). Capture VPC + subnets:
```bash
read VPC_ID SUBNET_A <<<"$(aws ec2 describe-instances --filters "Name=dns-name,Values=${EC2_HOST}" \
  --query "Reservations[0].Instances[0].[VpcId,SubnetId]" --output text)"
export VPC_ID SUBNET_A
aws ec2 describe-subnets --filters "Name=vpc-id,Values=$VPC_ID" \
  --query "Subnets[].{Id:SubnetId,AZ:AvailabilityZone,Public:MapPublicIpOnLaunch}" --output table
export SUBNET_B=[BRACKETS-second-public-subnet-in-another-AZ]
export INSTANCE_ID=$(aws ec2 describe-instances --filters "Name=dns-name,Values=${EC2_HOST}" \
  --query "Reservations[0].Instances[0].InstanceId" --output text)
```
- You control DNS for `[BRACKETS-domain]` to add the ACM validation CNAME and the final ALB alias.

### Steps

**1. Request + DNS-validate an ACM cert** (must be in `us-east-2`, same region as the ALB):
```bash
CERT_ARN=$(aws acm request-certificate \
  --domain-name "$APP_HOST" \
  --validation-method DNS \
  --query CertificateArn --output text)
export CERT_ARN
echo "$CERT_ARN"
# Get the CNAME to add at your DNS provider:
aws acm describe-certificate --certificate-arn "$CERT_ARN" \
  --query "Certificate.DomainValidationOptions[].ResourceRecord" --output table
# >>> Add that CNAME at your DNS host, then wait for issuance:
aws acm wait certificate-validated --certificate-arn "$CERT_ARN" && echo "Cert ISSUED"
```

**2. Security groups** — one for the ALB (public 443), one tightening the instance to only accept 8080 from the ALB:
```bash
ALB_SG=$(aws ec2 create-security-group --group-name taxflow-alb-sg \
  --description "TaxFlow ALB 443" --vpc-id "$VPC_ID" --query GroupId --output text)
aws ec2 authorize-security-group-ingress --group-id "$ALB_SG" \
  --protocol tcp --port 443 --cidr 0.0.0.0/0
export ALB_SG

# Instance SG: allow 8080 ONLY from the ALB SG; then remove public 8080.
export SG_ID=[BRACKETS-instance-sg-id]
aws ec2 authorize-security-group-ingress --group-id "$SG_ID" \
  --protocol tcp --port 8080 --source-group "$ALB_SG"
aws ec2 revoke-security-group-ingress --group-id "$SG_ID" \
  --protocol tcp --port 8080 --cidr 0.0.0.0/0
```

**3. Target group → register the instance → it must pass the health check on `/api/healthz`:**
```bash
TG_ARN=$(aws elbv2 create-target-group --name taxflow-tg \
  --protocol HTTP --port 8080 --vpc-id "$VPC_ID" --target-type instance \
  --health-check-path /api/healthz --health-check-protocol HTTP \
  --matcher HttpCode=200 --query "TargetGroups[0].TargetGroupArn" --output text)
export TG_ARN
aws elbv2 register-targets --target-group-arn "$TG_ARN" \
  --targets "Id=${INSTANCE_ID},Port=8080"
```

**4. Create the ALB + an HTTPS:443 listener using the ACM cert (TLS 1.2+ policy):**
```bash
ALB_ARN=$(aws elbv2 create-load-balancer --name taxflow-alb \
  --type application --scheme internet-facing \
  --subnets "$SUBNET_A" "$SUBNET_B" --security-groups "$ALB_SG" \
  --query "LoadBalancers[0].LoadBalancerArn" --output text)
export ALB_ARN
ALB_DNS=$(aws elbv2 describe-load-balancers --load-balancer-arns "$ALB_ARN" \
  --query "LoadBalancers[0].DNSName" --output text)
echo "ALB DNS: $ALB_DNS"

aws elbv2 create-listener --load-balancer-arn "$ALB_ARN" \
  --protocol HTTPS --port 443 \
  --ssl-policy ELBSecurityPolicy-TLS13-1-2-2021-06 \
  --certificates "CertificateArn=${CERT_ARN}" \
  --default-actions "Type=forward,TargetGroupArn=${TG_ARN}"
```

**5. Point `APP_HOST` DNS at the ALB** (CNAME `app.taxflow` → `$ALB_DNS`, or a Route 53 alias A record). Wait for the target to go healthy:
```bash
aws elbv2 describe-target-health --target-group-arn "$TG_ARN" \
  --query "TargetHealthDescriptions[].TargetHealth.State" --output text
# expect: healthy
```

Then proceed to **[App toggles to re-enable TLS-only behavior]** (set `trust proxy` and `ALLOWED_ORIGINS` to `https://$APP_HOST`).

> **Auth note:** ALB alone gives TLS, not auth. To also satisfy P0-4 auth on this path, add an **`authenticate-oidc`/`authenticate-cognito` action** to the listener later (Cognito user pool with the firm's CPAs + MFA). Until then, Option 2 needs the in-app auth (D15) before real PII flows.

### Verification
```bash
curl -sS https://${APP_HOST}/api/healthz ; echo
openssl s_client -connect ${APP_HOST}:443 -servername ${APP_HOST} </dev/null 2>/dev/null \
  | openssl x509 -noout -issuer -dates    # confirms ACM/Amazon-issued cert + validity
curl -m 5 -sS http://${EC2_HOST}:8080/api/healthz || echo "GOOD: :8080 not publicly reachable"
```

### Rollback
```bash
# Detach traffic by deleting the listener (instant), keep the rest for retry:
LISTENER_ARN=$(aws elbv2 describe-listeners --load-balancer-arn "$ALB_ARN" \
  --query "Listeners[0].ListenerArn" --output text)
aws elbv2 delete-listener --listener-arn "$LISTENER_ARN"
# Full teardown:
aws elbv2 delete-load-balancer --load-balancer-arn "$ALB_ARN"
aws elbv2 delete-target-group --target-group-arn "$TG_ARN"
# Restore direct access ONLY if forced to:
aws ec2 authorize-security-group-ingress --group-id "$SG_ID" --protocol tcp --port 8080 --cidr 0.0.0.0/0
```

---

## Option 3 — nginx + certbot on the box

Public-CA cert (Let's Encrypt) issued and auto-renewed on the instance; nginx reverse-proxies 443 → `127.0.0.1:8080`. Cheapest, fully self-managed.

### Prerequisites
- `APP_HOST` DNS **A record points directly at the EC2 public IP** (certbot's HTTP-01 challenge needs port 80 reachable on the box for that hostname).
- EC2 security group allows inbound **80 and 443** from `0.0.0.0/0` (80 is needed for the ACME challenge + the renewal; you may restrict 80 to a redirect after).

```bash
export SG_ID=[BRACKETS-instance-sg-id]
aws ec2 authorize-security-group-ingress --group-id "$SG_ID" --protocol tcp --port 80  --cidr 0.0.0.0/0
aws ec2 authorize-security-group-ingress --group-id "$SG_ID" --protocol tcp --port 443 --cidr 0.0.0.0/0
```

### Steps
```bash
# [ON BOX]
sudo apt-get update && sudo apt-get install -y nginx
sudo tee /etc/nginx/sites-available/taxflow >/dev/null <<'NGINX'
server {
    listen 80;
    listen [::]:80;
    server_name app.taxflow.[BRACKETS-domain];

    client_max_body_size 25m;

    location / {
        proxy_pass http://127.0.0.1:8080;
        proxy_set_header Host              $host;
        proxy_set_header X-Real-IP         $remote_addr;
        proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;   # certbot rewrites to https on 443
        proxy_read_timeout 120s;
    }
}
NGINX
# (hand-edit the server_name to the real host)
sudo ln -sf /etc/nginx/sites-available/taxflow /etc/nginx/sites-enabled/taxflow
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t && sudo systemctl reload nginx

# Issue + auto-wire the cert; certbot edits the server block to add the 443 ssl
# server and an http->https redirect, then installs a renewal systemd timer.
sudo apt-get install -y certbot python3-certbot-nginx
sudo certbot --nginx -d app.taxflow.[BRACKETS-domain] \
  --non-interactive --agree-tos -m [BRACKETS-ops-email] --redirect

# Confirm the renewal timer is active (renews ~60 days before expiry):
systemctl list-timers | grep certbot
sudo certbot renew --dry-run
```

**Harden:** once 443 works, remove the public 8080 SG rule (nginx reaches it on loopback):
```bash
aws ec2 revoke-security-group-ingress --group-id "$SG_ID" --protocol tcp --port 8080 --cidr 0.0.0.0/0
```

Then proceed to **[App toggles to re-enable TLS-only behavior]**.

> **Auth note:** Option 3 is TLS only. P0-4 auth still requires in-app auth (D15) before real PII flows; this option does not provide the Cloudflare-Access-style identity gate that Option 1 does.

### Verification
```bash
curl -sS https://${APP_HOST}/api/healthz ; echo
curl -sSI http://${APP_HOST}/api/healthz | grep -i -E "HTTP/|location"   # expect 301 -> https
sudo certbot certificates    # shows the cert + expiry
```

### Rollback
```bash
# [ON BOX]
sudo systemctl stop nginx
# Restore direct cleartext ONLY if forced:
# aws ec2 authorize-security-group-ingress --group-id "$SG_ID" --protocol tcp --port 8080 --cidr 0.0.0.0/0
# Remove cert later if abandoning:
# sudo certbot delete --cert-name app.taxflow.[BRACKETS-domain]
```

---

## App toggles to re-enable TLS-only behavior (do this for ALL three options, only after :443 responds)

`artifacts/api-server/src/app.ts` currently **disables two HTTPS-only behaviors** because port 443 was closed (a blank-page guard documented in the file): HSTS is `false`, and the CSP `upgrade-insecure-requests` directive is overridden to `null`. Once TLS is live and :443 actually answers, flip them back, and lock CORS + trust-proxy to the HTTPS host.

**1. HSTS — turn it on.** In the `helmet({...})` call, change `hsts: false` to:
```ts
    hsts: { maxAge: 31536000, includeSubDomains: true, preload: true },
```

**2. Restore the CSP auto-upgrade.** In `contentSecurityPolicy.directives`, **remove** this line so Helmet's default (which includes `upgrade-insecure-requests`) applies:
```ts
        // DELETE this override now that :443 responds:
        upgradeInsecureRequests: null,
```

**3. Lock CORS to the HTTPS origin.** The app already reads `ALLOWED_ORIGINS` (comma-separated; empty + non-prod = allow-all). Set it in the runtime env so cross-origin is restricted in production:
```
ALLOWED_ORIGINS=https://app.taxflow.[BRACKETS-domain]
```
(If the SPA is served same-origin from Express, you may not need any cross-origin entry — but setting it ensures `corsAllowAll` is false in production. Confirm `NODE_ENV=production` is set on the box.)

**4. `trust proxy` — confirm the hop count.** app.ts already sets `app.set("trust proxy", 1)`. That `1` is correct for **exactly one** proxy in front (nginx, single ALB, or Cloudflare→nginx counts as the nginx hop for the box). If you stack **Cloudflare + nginx** (Option 1), the box still sees only nginx as its immediate proxy, so `1` is right *for the box*; nginx forwards the real client IP via `X-Forwarded-For`. Only raise this number if you add another reverse-proxy hop. Wrong values here let clients spoof `X-Forwarded-For` and defeat `express-rate-limit`.

**5. Rebuild + restart + deploy** (per the documented EC2 cycle — local frontend build, esbuild on box):
```bash
# [ON BOX] after `git pull` of the toggled app.ts
cd ~/taxflow-pro
git checkout -- pnpm-lock.yaml && git pull origin main && pnpm install
# Set the production env that pm2 will carry (see Runbook C for the durable version):
pm2 set pm2:autodump true
export ALLOWED_ORIGINS=https://app.taxflow.[BRACKETS-domain]
export NODE_ENV=production
pnpm --filter @workspace/api-server run build
pm2 restart taxflow --update-env
curl http://localhost:8080/api/healthz
```

### Verification (toggles)
```bash
# HSTS header present (only meaningful over https):
curl -sSI https://${APP_HOST}/ | grep -i strict-transport-security
# CORS rejects a foreign origin in production:
curl -sS -H "Origin: https://evil.example" -I https://${APP_HOST}/api/healthz | grep -i -E "access-control-allow-origin" || echo "GOOD: foreign origin not allowed"
```

### Rollback (toggles)
Revert app.ts: set `hsts: false`, re-add `upgradeInsecureRequests: null`, rebuild + `pm2 restart taxflow --update-env`. (Note: HSTS, once sent, is cached by browsers for `maxAge` — start with a short `maxAge` like `300` on first cutover if you want a cheap escape hatch, then raise to a year once stable.)

---

# Runbook B — Document Storage to S3 + SSE-KMS

**Goal:** Move tax-document bytes out of `tax_documents.file_content` (base64 plaintext in Neon) into a **private, encrypted-at-rest (SSE-KMS), TLS-only S3 bucket**, served to the UI via **short-lived presigned GET URLs**. This closes the "at rest" half of the Safeguards Rule for the document-blob path (the largest concentration of plaintext PII — full W-2/1099/K-1 images with SSNs).

> Scope note: this runbook covers the **document blobs**. Field-level SSN/TIN columns (`employee_ssn`, `payer_tin`, `recipient_tin`) are a separate P0-5 encryption work item (pgcrypto/KMS envelope), tracked in the WISP encryption plan — not here.

### Prerequisites
- AWS CLI configured on your laptop (`us-east-2`), with permission to create KMS keys, S3 buckets, and IAM roles/policies.
- The api-server build adds the AWS SDK v3. It is **not currently a dependency** (`artifacts/api-server/package.json` has no `@aws-sdk/*`). Add it and, because the build is esbuild-bundled, decide bundling: the v3 client bundles fine, but if you see resolution issues add `@aws-sdk/*` to the `external` array in `artifacts/api-server/build.mjs` (alongside `pdfkit`, `sharp`, etc.).
```bash
pnpm --filter @workspace/api-server add @aws-sdk/client-s3 @aws-sdk/s3-request-presigner
```

### Step 1 — Create a customer-managed KMS key
```bash
KMS_KEY_ID=$(aws kms create-key \
  --description "TaxFlow tax-document encryption (SSE-KMS)" \
  --key-usage ENCRYPT_DECRYPT --key-spec SYMMETRIC_DEFAULT \
  --tags TagKey=app,TagValue=taxflow TagKey=purpose,TagValue=document-pii \
  --query "KeyMetadata.KeyId" --output text)
aws kms create-alias --alias-name alias/taxflow-documents --target-key-id "$KMS_KEY_ID"
export KMS_KEY_ID
export KMS_KEY_ARN=$(aws kms describe-key --key-id "$KMS_KEY_ID" --query "KeyMetadata.Arn" --output text)
echo "$KMS_KEY_ARN"
```

### Step 2 — Create a private bucket; block public access; default SSE-KMS; TLS-only policy; versioning
```bash
export BUCKET=taxflow-documents-prod-${AWS_ACCOUNT_ID}   # globally-unique
aws s3api create-bucket --bucket "$BUCKET" --region "$AWS_REGION" \
  --create-bucket-configuration LocationConstraint="$AWS_REGION"

# Block ALL public access:
aws s3api put-public-access-block --bucket "$BUCKET" \
  --public-access-block-configuration \
  BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true

# Default encryption = SSE-KMS with our key; enforce bucket keys (cheaper KMS calls):
aws s3api put-bucket-encryption --bucket "$BUCKET" \
  --server-side-encryption-configuration "{
    \"Rules\":[{\"ApplyServerSideEncryptionByDefault\":
      {\"SSEAlgorithm\":\"aws:kms\",\"KMSMasterKeyID\":\"${KMS_KEY_ARN}\"},
      \"BucketKeyEnabled\":true}]}"

# Versioning (protects against accidental/malicious overwrite/delete):
aws s3api put-bucket-versioning --bucket "$BUCKET" \
  --versioning-configuration Status=Enabled

# Bucket policy: deny any non-TLS request AND deny uploads that aren't SSE-KMS with our key.
cat > /tmp/taxflow-bucket-policy.json <<POLICY
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "DenyInsecureTransport",
      "Effect": "Deny",
      "Principal": "*",
      "Action": "s3:*",
      "Resource": ["arn:aws:s3:::${BUCKET}", "arn:aws:s3:::${BUCKET}/*"],
      "Condition": { "Bool": { "aws:SecureTransport": "false" } }
    },
    {
      "Sid": "DenyWrongEncryption",
      "Effect": "Deny",
      "Principal": "*",
      "Action": "s3:PutObject",
      "Resource": "arn:aws:s3:::${BUCKET}/*",
      "Condition": {
        "StringNotEquals": { "s3:x-amz-server-side-encryption": "aws:kms" }
      }
    }
  ]
}
POLICY
aws s3api put-bucket-policy --bucket "$BUCKET" --policy file:///tmp/taxflow-bucket-policy.json
```

### Step 3 — IAM role + policy for the EC2 instance
The box should assume a role (instance profile) — never long-lived keys. Create the role, a least-privilege policy (scoped to this bucket + this KMS key), and attach an instance profile to the EC2 instance.

```bash
# Trust policy: EC2 can assume the role.
cat > /tmp/ec2-trust.json <<'TRUST'
{ "Version":"2012-10-17","Statement":[{"Effect":"Allow",
  "Principal":{"Service":"ec2.amazonaws.com"},"Action":"sts:AssumeRole"}]}
TRUST
aws iam create-role --role-name taxflow-ec2-role \
  --assume-role-policy-document file:///tmp/ec2-trust.json

# Permission policy: only this bucket's objects + only this KMS key.
cat > /tmp/taxflow-ec2-policy.json <<POLICY
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "DocBucketObjects",
      "Effect": "Allow",
      "Action": ["s3:GetObject","s3:PutObject","s3:DeleteObject"],
      "Resource": "arn:aws:s3:::${BUCKET}/*"
    },
    {
      "Sid": "DocBucketList",
      "Effect": "Allow",
      "Action": ["s3:ListBucket"],
      "Resource": "arn:aws:s3:::${BUCKET}"
    },
    {
      "Sid": "UseDocKmsKey",
      "Effect": "Allow",
      "Action": ["kms:Encrypt","kms:Decrypt","kms:GenerateDataKey","kms:DescribeKey"],
      "Resource": "${KMS_KEY_ARN}"
    }
  ]
}
POLICY
aws iam put-role-policy --role-name taxflow-ec2-role \
  --policy-name taxflow-ec2-inline --policy-document file:///tmp/taxflow-ec2-policy.json

# Instance profile + attach to the running instance.
aws iam create-instance-profile --instance-profile-name taxflow-ec2-profile
aws iam add-role-to-instance-profile \
  --instance-profile-name taxflow-ec2-profile --role-name taxflow-ec2-role

export INSTANCE_ID=$(aws ec2 describe-instances --filters "Name=dns-name,Values=${EC2_HOST}" \
  --query "Reservations[0].Instances[0].InstanceId" --output text)
aws ec2 associate-iam-instance-profile \
  --instance-id "$INSTANCE_ID" \
  --iam-instance-profile Name=taxflow-ec2-profile
```
Verify the box can see the role (IMDS):
```bash
# [ON BOX]
TOKEN=$(curl -s -X PUT "http://169.254.169.254/latest/api/token" -H "X-aws-ec2-metadata-token-ttl-seconds: 60")
curl -s -H "X-aws-ec2-metadata-token: $TOKEN" http://169.254.169.254/latest/meta-data/iam/security-credentials/
# expect: taxflow-ec2-role
```

### Step 4 — Schema change: `file_content` → `s3_key` + `content_hash`
`lib/db/src/schema/tax-documents.ts` currently has `fileContent: text("file_content")`. Add the new columns (keep `file_content` nullable through the migration so existing rows survive until backfilled):

```ts
// in taxDocumentsTable:
  fileContent: text("file_content"),                 // KEEP nullable during migration; drop after backfill
  s3Key: text("s3_key"),                              // e.g. "12/8821" -> {clientId}/{docId}
  contentHash: text("content_hash"),                  // sha256 hex of the raw bytes (integrity)
  contentType: text("content_type"),                  // captured at upload (detectMimeType result)
  byteSize: integer("byte_size"),
```
Apply with the documented workflow:
```bash
pnpm --filter @workspace/db run push      # dev DB
# On the box (prod) per CLAUDE.md EC2 deploy: pnpm --filter @workspace/db run push
```

### Step 5 — Code: write to S3 on upload, read via presigned URL
Add a small S3 helper (`artifacts/api-server/src/lib/documentStore.ts`):

```ts
import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { createHash } from "node:crypto";

const s3 = new S3Client({ region: process.env.AWS_REGION ?? "us-east-2" });
const BUCKET = process.env.DOCUMENTS_BUCKET!;          // taxflow-documents-prod-<acct>
const KMS_KEY = process.env.DOCUMENTS_KMS_KEY_ARN!;    // alias/taxflow-documents ARN

export function s3KeyFor(clientId: number, docId: number) {
  return `${clientId}/${docId}`;
}
export function sha256Hex(buf: Buffer) {
  return createHash("sha256").update(buf).digest("hex");
}
export async function putDocument(key: string, body: Buffer, contentType: string) {
  await s3.send(new PutObjectCommand({
    Bucket: BUCKET, Key: key, Body: body, ContentType: contentType,
    ServerSideEncryption: "aws:kms", SSEKMSKeyId: KMS_KEY,
  }));
}
export async function presignGet(key: string, fileName: string, contentType: string, ttlSeconds = 300) {
  return getSignedUrl(s3, new GetObjectCommand({
    Bucket: BUCKET, Key: key,
    ResponseContentType: contentType,
    ResponseContentDisposition: `inline; filename="${fileName.replace(/"/g, "")}"`,
  }), { expiresIn: ttlSeconds });
}
export async function deleteDocument(key: string) {
  await s3.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: key }));
}
```

Wire it into `artifacts/api-server/src/routes/documents.ts`:

- **POST `/clients/:clientId/documents`** (around the `db.insert(...).values({...fileContent})` block, lines ~119–128): decode the incoming base64 once, hash it, insert the row to get the `doc.id`, then `putDocument(s3KeyFor(clientId, doc.id), buffer, mimeType)` and `db.update` the row with `s3Key`, `contentHash`, `contentType`, `byteSize`. **Stop persisting `fileContent`.** The async extraction IIFE can keep using the in-memory `buffer`/base64 it already has — Gemini still receives the bytes in-process; nothing about the §7216 posture changes here (that's P0-2).
- **GET `/clients/:clientId/documents/:documentId/content`** (lines ~198–227): instead of `Buffer.from(doc.fileContent, "base64")` + `res.send`, look up `doc.s3Key` and **302-redirect to a presigned URL**:
  ```ts
  if (!doc?.s3Key) { res.status(404).json({ error: "Document content not found" }); return; }
  const url = await presignGet(doc.s3Key, doc.fileName, doc.contentType ?? detectMimeType(doc.fileName));
  res.redirect(302, url);
  ```
  (Alternatively, return `{ url }` as JSON and have the frontend `BoundedDocumentViewer` fetch it — but a 302 is the smallest frontend change. Keep `Cache-Control: private` semantics; presigned URLs already expire in 5 min.)
- **DELETE** handler (line ~229): also `deleteDocument(doc.s3Key)` (best-effort; log on failure) so secure-disposal (§314.4(c)(6)) actually removes the bytes, not just the row.

Add the runtime env (durably via Runbook C / pm2):
```
AWS_REGION=us-east-2
DOCUMENTS_BUCKET=taxflow-documents-prod-[BRACKETS-acct]
DOCUMENTS_KMS_KEY_ARN=arn:aws:kms:us-east-2:[BRACKETS-acct]:key/[BRACKETS-key-id]
```

### Step 6 — Backfill existing base64 blobs into S3
One-time migration script (`scripts/src/migrate-documents-to-s3.ts`) that streams rows with a non-null `file_content`, uploads each to `s3://BUCKET/{clientId}/{docId}`, writes `s3_key`/`content_hash`/`content_type`/`byte_size`, then **null out `file_content`** once the upload + hash verify succeed:

```ts
// Pseudocode of the loop — run from the box (or anywhere with the instance role / temp creds):
//   for each row where file_content is not null:
//     const buf = Buffer.from(row.file_content, "base64");
//     const key = `${row.client_id}/${row.id}`;
//     await putDocument(key, buf, detectMimeType(row.file_name));
//     // read it back, verify sha256 matches before destroying the source:
//     const back = await getObjectBytes(key);
//     assert(sha256Hex(back) === sha256Hex(buf));
//     await db.update(... { s3Key: key, contentHash: sha256Hex(buf),
//                           contentType: detectMimeType(row.file_name),
//                           byteSize: buf.length, fileContent: null }) .where(id = row.id);
```
Run:
```bash
# [ON BOX]
cd ~/taxflow-pro
export DATABASE_URL=$(pm2 env 0 | awk -F": " '/^DATABASE_URL:/ {print $2; exit}')
export DOCUMENTS_BUCKET=taxflow-documents-prod-[BRACKETS-acct]
export DOCUMENTS_KMS_KEY_ARN=arn:aws:kms:us-east-2:[BRACKETS-acct]:key/[BRACKETS-key-id]
pnpm --filter @workspace/scripts exec tsx ./src/migrate-documents-to-s3.ts
```
After confirming **zero** rows have a non-null `file_content`, drop the column in a follow-up migration (`ALTER TABLE tax_documents DROP COLUMN file_content;`).

### Verification
```bash
# Bucket is private + encrypted + TLS-enforced:
aws s3api get-public-access-block --bucket "$BUCKET"
aws s3api get-bucket-encryption  --bucket "$BUCKET" --query "ServerSideEncryptionConfiguration.Rules[0]"
# Direct unsigned object GET is denied (the bucket policy / ACLs block it):
aws s3api get-object --bucket "$BUCKET" --key 1/1 /tmp/probe 2>&1 | grep -qi "AccessDenied\|Forbidden\|NoSuchKey" && echo "GOOD: not publicly readable"
# App returns a presigned URL / 302 that actually serves the bytes:
curl -sSI https://${APP_HOST}/api/clients/[BRACKETS-clientId]/documents/[BRACKETS-docId]/content | grep -i -E "HTTP/|location"
# DB no longer holds plaintext blobs:
#   SELECT count(*) FROM tax_documents WHERE file_content IS NOT NULL;  -> 0
```

### Rollback
- Code path: revert the `documents.ts` changes (the `/content` route again reads `fileContent`). Because the backfill only **nulls** `file_content` after a verified S3 write, do **not** drop the column until you're certain; if you've already dropped it, restore from a Neon point-in-time/branch backup.
- Infra: objects remain in S3 (versioned). To fully tear down (only if abandoning): empty the bucket, `aws s3 rb s3://$BUCKET --force`, `aws kms schedule-key-deletion --key-id "$KMS_KEY_ID" --pending-window-in-days 30` (KMS keys can't be deleted instantly — schedule, then cancel within the window if you change your mind).

---

# Runbook C — Secrets Management

**Goal:** Get the Neon `DATABASE_URL` and the Gemini `AI_API_KEY` **out of the pm2 process environment** (where they're long-lived plaintext, and where the leaked-and-being-rotated copies live) into **AWS SSM Parameter Store (SecureString)** — KMS-encrypted, IAM-gated, auditable, rotatable. Load them at boot. Establish a rotation procedure.

> SSM Parameter Store (SecureString) is the cheaper/simpler choice and is sufficient here. **AWS Secrets Manager** is the alternative if you want **managed automatic rotation** (it has native rotation Lambdas; Neon would need a custom rotation function). Both are shown; pick SSM unless you specifically need Secrets Manager's scheduled rotation. The app reads two env vars today — `DATABASE_URL` (consumed in `lib/db/src/index.ts`, which already enables TLS for `*.neon.tech`) and `AI_API_KEY` (consumed in `lib/integrations-openai-ai-server/src/client.ts`).

### Prerequisites
- The EC2 instance role from **Runbook B Step 3** (`taxflow-ec2-role`) exists. If you did Runbook B, reuse it; otherwise create it (see that step).
- The leaked credentials have been **rotated first** (P0-1): create a new Neon role/password and a new Gemini API key, and put the **new** values into the secret store. Never store the leaked values.

### Step 1 — Store the rotated secrets (SSM SecureString)
```bash
# Use the same customer-managed key, or the AWS-managed alias/aws/ssm. Here: our key.
export KMS_KEY_ARN=$(aws kms describe-key --key-id alias/taxflow-documents \
  --query "KeyMetadata.Arn" --output text 2>/dev/null || echo "alias/aws/ssm")

aws ssm put-parameter --name "/taxflow/prod/DATABASE_URL" --type SecureString \
  --key-id "$KMS_KEY_ARN" --overwrite \
  --value 'postgres://[BRACKETS-new-neon-user]:[BRACKETS-new-neon-pass]@[BRACKETS-host].neon.tech/[BRACKETS-db]?sslmode=require'

aws ssm put-parameter --name "/taxflow/prod/AI_API_KEY" --type SecureString \
  --key-id "$KMS_KEY_ARN" --overwrite \
  --value '[BRACKETS-new-gemini-key]'

# Optional: also park the non-secret runtime config here for one source of truth.
aws ssm put-parameter --name "/taxflow/prod/ALLOWED_ORIGINS" --type String --overwrite \
  --value "https://app.taxflow.[BRACKETS-domain]"
```

> **Secrets Manager alternative** (if you want managed rotation):
> ```bash
> aws secretsmanager create-secret --name taxflow/prod/DATABASE_URL \
>   --kms-key-id "$KMS_KEY_ARN" --secret-string '[BRACKETS-conn-string]'
> aws secretsmanager create-secret --name taxflow/prod/AI_API_KEY \
>   --kms-key-id "$KMS_KEY_ARN" --secret-string '[BRACKETS-key]'
> ```

### Step 2 — IAM: allow the instance role to read just these parameters
Add an inline policy to `taxflow-ec2-role` (scope to the `/taxflow/prod/*` path + the KMS key used to encrypt them):
```bash
cat > /tmp/taxflow-ssm-policy.json <<POLICY
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "ReadTaxflowParams",
      "Effect": "Allow",
      "Action": ["ssm:GetParameter","ssm:GetParameters","ssm:GetParametersByPath"],
      "Resource": "arn:aws:ssm:${AWS_REGION}:${AWS_ACCOUNT_ID}:parameter/taxflow/prod/*"
    },
    {
      "Sid": "DecryptParams",
      "Effect": "Allow",
      "Action": ["kms:Decrypt"],
      "Resource": "${KMS_KEY_ARN}"
    }
  ]
}
POLICY
aws iam put-role-policy --role-name taxflow-ec2-role \
  --policy-name taxflow-ssm-read --policy-document file:///tmp/taxflow-ssm-policy.json
```
*(For Secrets Manager, swap the `ssm:*` actions for `secretsmanager:GetSecretValue` and the resource for the secret ARNs.)*

### Step 3 — Load secrets at boot (replace the pm2-env bake-in)
Today the deploy sources creds out of the pm2 env (`pm2 env 0 | awk ...`). Replace that with a tiny **fetch-then-exec** wrapper so the process gets the secrets from SSM at start and they never persist in the pm2 dump. Create `~/taxflow-pro/scripts/load-secrets-and-start.sh` on the box:

```bash
#!/usr/bin/env bash
set -euo pipefail
export AWS_REGION=us-east-2
# Pull every /taxflow/prod/* param, decrypt, export as NAME=value.
while IFS=$'\t' read -r name value; do
  export "${name##*/}=${value}"
done < <(aws ssm get-parameters-by-path \
           --path /taxflow/prod --recursive --with-decryption \
           --query "Parameters[].[Name,Value]" --output text)
export NODE_ENV=production
exec node --enable-source-maps /home/ubuntu/taxflow-pro/artifacts/api-server/dist/index.mjs
```
```bash
# [ON BOX]
chmod +x ~/taxflow-pro/scripts/load-secrets-and-start.sh
# Re-point pm2 at the wrapper (one-time). Delete the old env-baked process first:
pm2 delete taxflow || true
pm2 start ~/taxflow-pro/scripts/load-secrets-and-start.sh --name taxflow --interpreter bash
pm2 save
```
Now the pm2 process env no longer contains the raw secrets; they're fetched at each (re)start. Confirm the dump is clean:
```bash
pm2 env 0 | grep -E "DATABASE_URL|AI_API_KEY" || echo "GOOD: secrets not in pm2 env"
```

> **App-side alternative (no shell wrapper):** add `@aws-sdk/client-ssm` and fetch the parameters in `artifacts/api-server/src/index.ts` *before* `import app` (top-level await), setting `process.env.DATABASE_URL` / `process.env.AI_API_KEY`. The DB pool (`lib/db/src/index.ts`) reads `process.env.DATABASE_URL` at module load, so the fetch must complete before that module is imported — dynamic-import `./app` after the secrets are populated. The shell wrapper above avoids that import-ordering hazard and is the lower-risk first step.

### Step 4 — Update the deploy runbook
The CLAUDE.md EC2 deploy block currently does `export DATABASE_URL=$(pm2 env 0 | awk ...)`. After this runbook, **drop those two `export` lines** — the wrapper supplies them. The deploy becomes:
```bash
ssh -i ~/Downloads/taxflow-key.pem ubuntu@${EC2_HOST}
cd ~/taxflow-pro
git checkout -- pnpm-lock.yaml && git pull origin main && pnpm install
pnpm --filter @workspace/db run push        # only if schema changed
pnpm --filter @workspace/api-server run build
pm2 restart taxflow                          # wrapper re-fetches secrets from SSM
curl http://localhost:8080/api/healthz
```

### Step 5 — Rotation procedure
**Routine (no leak), recommended at least every 90 days per the WISP change-management cadence:**
1. Create a new Neon role/password (or a new Gemini key) in the provider console.
2. `aws ssm put-parameter --name /taxflow/prod/DATABASE_URL --type SecureString --overwrite --value '<new>'` (same for `AI_API_KEY`).
3. `ssh ... 'pm2 restart taxflow'` — the wrapper picks up the new value. Verify `curl .../api/healthz` and a real DB-backed endpoint (e.g. `GET /api/clients`).
4. **Revoke the old credential** in the provider console (delete the old Neon role / disable the old Gemini key). Confirm the app still works (proves it's on the new secret).

**Emergency (active leak, like the one this P0 batch is fixing):** do step 1 + 4 first (rotate-and-revoke at the provider immediately), then step 2 + 3.

> **Secrets Manager rotation:** attach a rotation Lambda and `aws secretsmanager rotate-secret --secret-id taxflow/prod/DATABASE_URL --rotation-lambda-arn [BRACKETS] --rotation-rules AutomaticallyAfterDays=90`. Neon rotation needs a custom Lambda (no AWS-provided template); the manual SSM cadence above is simpler to stand up first.

### Verification
```bash
aws ssm get-parameter --name /taxflow/prod/DATABASE_URL --with-decryption \
  --query "Parameter.{Type:Type,Modified:LastModifiedDate}" --output table   # Type=SecureString
# The instance role can read it (run on box):
# [ON BOX]
aws ssm get-parameter --name /taxflow/prod/AI_API_KEY --with-decryption --query "Parameter.Name" --output text
# App is alive on secrets it fetched at boot:
curl -sS http://localhost:8080/api/healthz ; echo
```

### Rollback
- Re-point pm2 at the old direct start with env baked in (temporary): `pm2 delete taxflow; DATABASE_URL='<new-from-ssm>' AI_API_KEY='<new-from-ssm>' pm2 start ~/taxflow-pro/artifacts/api-server/dist/index.mjs --name taxflow; pm2 save`. **Use the rotated values from SSM, never the leaked originals.**
- Remove the IAM read policy if abandoning: `aws iam delete-role-policy --role-name taxflow-ec2-role --policy-name taxflow-ssm-read`.

---

# Definition of Done

Mapping to the P0 items in `docs/product-assessment-2026-06-02.md`.

### P0-4 — Auth + TLS
- [ ] HTTPS responds on `https://app.taxflow.[BRACKETS-domain]/api/healthz` (one of Runbook A Option 1/2/3 live).
- [ ] Raw cleartext `http://${EC2_HOST}:8080` is **not reachable from the public internet** (8080 SG rule removed; traffic only via the TLS front door).
- [ ] `app.ts` TLS-only toggles re-enabled: `hsts: { maxAge: 31536000, includeSubDomains: true, preload: true }`, `upgradeInsecureRequests` override removed, `ALLOWED_ORIGINS=https://app.taxflow.[BRACKETS-domain]`, `trust proxy` hop count correct. Verified: HSTS header present, foreign-origin CORS rejected.
- [ ] **Auth in front of all 79 endpoints**: Cloudflare Access policy live (Runbook A Option 1) **OR** in-app auth (D15) shipped. If TLS is via ALB/nginx (Options 2/3) and D15 isn't done yet, this box is **NOT** checked — TLS alone does not satisfy the auth half of P0-4. (Satisfies Safeguards Rule §314.4(c)(1)/(5) access control + MFA when Cloudflare Access/OIDC + MFA is the gate.)

### P0-5 — Encrypt PII at rest (document blobs)
- [ ] KMS customer-managed key `alias/taxflow-documents` created.
- [ ] Private S3 bucket: public access fully blocked, default SSE-KMS with our key, TLS-only + wrong-encryption-deny bucket policy, versioning on. Verified via `get-public-access-block` + `get-bucket-encryption`.
- [ ] EC2 instance role (`taxflow-ec2-profile`) grants least-privilege S3 + KMS; box reaches the bucket via the role (no static keys).
- [ ] `tax_documents` schema migrated to `s3_key` + `content_hash` (+ `content_type`/`byte_size`); upload writes to S3 (SSE-KMS), `/content` serves via **short-lived presigned GET**, delete removes the object.
- [ ] Backfill complete: `SELECT count(*) FROM tax_documents WHERE file_content IS NOT NULL;` returns **0**; `file_content` column dropped. (Satisfies Safeguards Rule §314.4(c)(3) encryption-at-rest for document PII + §314.4(c)(6) secure disposal on delete.)
- [ ] *(Tracked separately — NOT this runbook:)* field-level `employee_ssn`/`payer_tin`/`recipient_tin` encryption (pgcrypto/KMS envelope). P0-5's column-encryption half remains open until that lands.

### P0-1 — Rotate leaked creds → managed secret store
- [ ] Neon password **and** Gemini key **rotated at the provider**; old credentials **revoked**.
- [ ] New values stored in SSM Parameter Store SecureString under `/taxflow/prod/*` (KMS-encrypted); instance role can read them.
- [ ] App loads secrets at boot via the wrapper; `pm2 env 0` no longer exposes `DATABASE_URL`/`AI_API_KEY`. Verified app is alive on the fetched secrets.
- [ ] Deploy runbook updated (the `pm2 env 0 | awk ...` export lines removed); rotation procedure documented + dry-run-tested. (Satisfies Safeguards Rule §314.4(b)/(e) risk-assessment + change-management for credential handling.)

### Cross-cutting
- [ ] **[LEGAL REVIEW]** Sign-off recorded that infra-side P0-1/P0-4/P0-5 are complete **but real client PII still gated on P0-2 (§7216 consent flow + Google DPA) and P0-3 (WISP with named Qualified Individual)**. TLS + encrypted storage ≠ clearance to process live taxpayer data through Gemini.
- [ ] The demo banner ("do not upload real tax documents") stays up until all P0 items — including P0-2/P0-3 — are closed and the [LEGAL REVIEW] sign-off above is in writing.
