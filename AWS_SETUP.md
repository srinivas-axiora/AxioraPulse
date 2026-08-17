# AWS ECS Deployment Setup — AxioraPulse

Complete one-time AWS setup for deploying frontend and backend to ECS Fargate behind CloudFront.  
**Region:** `ap-south-1` (Mumbai) | **Account:** `847013096108` | **Domain:** `axiorapulse.com`

---

## Architecture

```
Browser
  │
  ├─ axiorapulse.com / www.axiorapulse.com
  │     └─→ CloudFront (frontend distro) ──→ ALB ──→ pulse-frontend-tg ──→ Nginx ECS
  │
  └─ api.axiorapulse.com
        └─→ CloudFront (API distro) ──→ ALB ──→ pulse-backend-tg ──→ FastAPI ECS
```

CloudFront provides HTTPS termination, global CDN, and AWS Shield Standard (DDoS protection).  
The ALB is locked down to accept traffic **only from CloudFront** after Step 19.

---

## Checklist

```
[ ] 1.  IAM — ecsTaskExecutionRole
[ ] 2.  IAM — ecsTaskRole
[ ] 3.  SSM — 9 secret parameters
[ ] 4.  ECR — axiora/pulse-frontend repository
[ ] 5.  CloudWatch — /ecs/pulse-backend log group
[ ] 6.  CloudWatch — /ecs/pulse-frontend log group
[ ] 7.  VPC — pulse-alb-sg security group (open internet initially)
[ ] 8.  VPC — pulse-backend-sg security group
[ ] 9.  VPC — pulse-frontend-sg security group
[ ] 10. ECS — axiora-pulse-cluster
[ ] 11. ALB — pulse-backend-tg target group
[ ] 12. ALB — pulse-frontend-tg target group
[ ] 13. ALB — axiora-pulse-alb load balancer
[ ] 14. ACM (ap-south-1) — SSL certificate for ALB
[ ] 15. ALB — HTTPS listener + backend host-based rule
[ ] 16. ACM (us-east-1) — SSL certificate for CloudFront   ← must be N. Virginia
[ ] 17. CloudFront — frontend distribution (axiorapulse.com + www)
[ ] 18. CloudFront — API distribution (api.axiorapulse.com)
[ ] 19. VPC — Lock ALB to CloudFront-only traffic
[ ] 20. ECS — Register task definitions (CLI)
[ ] 21. ECR — Push initial images (CLI)
[ ] 22. ECS — pulse-backend-service
[ ] 23. ECS — pulse-frontend-service
[ ] 24. Route 53 — Create hosted zone + delegate from GoDaddy
[ ] 25. DNS — Records for axiorapulse.com and api.axiorapulse.com
[ ] 26. GitHub — Repository secrets
```

---

## Step 1 — IAM: ecsTaskExecutionRole

Allows ECS to pull images from ECR and read secrets from SSM.

1. Go to **IAM → Roles → Create role**
2. Trusted entity type: **AWS service**
3. Use case: **Elastic Container Service Task** → Next
4. Attach these managed policies:
   - `AmazonECSTaskExecutionRolePolicy`
   - `AmazonSSMReadOnlyAccess`
5. Role name: `ecsTaskExecutionRole`
6. **Create role**

---

## Step 2 — IAM: ecsTaskRole

The role your running containers assume.

1. **IAM → Roles → Create role**
2. Trusted entity: **AWS service** → **Elastic Container Service Task** → Next
3. Skip attaching policies (click Next without selecting any)
4. Role name: `ecsTaskRole`
5. **Create role**

---

## Step 3 — SSM Parameter Store: Secrets

Go to **Systems Manager → Parameter Store → Create parameter**

For every parameter below:
- Tier: **Standard**
- Type: **SecureString**
- KMS key: **alias/aws/ssm** (default)

| Parameter Name | Value |
|---|---|
| `/axiorapulse/production/SECRET_KEY` | Long random JWT signing key |
| `/axiorapulse/production/DATABASE_URL` | `postgresql+psycopg2://postgres:[password]@[host]:5432/postgres` |
| `/axiorapulse/production/OPENAI_API_KEY` | `sk-...` |
| `/axiorapulse/production/GOOGLE_API_KEY` | Google Gemini API key |
| `/axiorapulse/production/RESEND_API_KEY` | From resend.com |
| `/axiorapulse/production/EMAIL_FROM` | `Axiora Pulse <noreply@axiorapulse.com>` |
| `/axiorapulse/production/FRONTEND_URL` | `https://axiorapulse.com` |
| `/axiorapulse/production/EMAIL_USER` | SMTP email address |
| `/axiorapulse/production/EMAIL_PASS` | SMTP app password |

> Create all 9. The task definition references every one of them.

---

## Step 4 — ECR: Frontend Repository

The backend repo already exists. Create the frontend one.

1. Go to **ECR → Repositories → Create repository**
2. Visibility: **Private**
3. Repository name: `axiora/pulse-frontend`
4. Image tag mutability: **Mutable**
5. Encryption: **AES-256** (default)
6. **Create repository**

Your two repos are now:
- `847013096108.dkr.ecr.ap-south-1.amazonaws.com/axiora/pulse-fastapi` ✅
- `847013096108.dkr.ecr.ap-south-1.amazonaws.com/axiora/pulse-frontend` ✅

---

## Step 5 & 6 — CloudWatch: Log Groups

Go to **CloudWatch → Log groups → Create log group**

Create both:

| Log group name | Retention |
|---|---|
| `/ecs/pulse-backend` | 30 days |
| `/ecs/pulse-frontend` | 30 days |

---

## Step 7 — Security Group: ALB

> You will restrict this to CloudFront-only in Step 19. For now, open it to the internet so you can test the ALB directly before CloudFront is in front.

1. **VPC → Security Groups → Create security group**
2. Name: `pulse-alb-sg`
3. Description: `Allow HTTP and HTTPS from internet (restricted to CloudFront in Step 19)`
4. VPC: **default VPC**
5. Inbound rules:

| Type | Port | Source |
|---|---|---|
| HTTP | 80 | `0.0.0.0/0` |
| HTTPS | 443 | `0.0.0.0/0` |

6. Outbound: leave default (all traffic)
7. **Create security group** — note the SG ID (e.g. `sg-aaaa1111`)

---

## Step 8 — Security Group: Backend

1. **Create security group**
2. Name: `pulse-backend-sg`
3. Description: `Allow port 8000 from ALB only`
4. VPC: **default VPC**
5. Inbound rules:

| Type | Port | Source |
|---|---|---|
| Custom TCP | 8000 | `pulse-alb-sg` (select the SG from Step 7) |

6. Outbound: leave default
7. **Create security group**

---

## Step 9 — Security Group: Frontend

1. **Create security group**
2. Name: `pulse-frontend-sg`
3. Description: `Allow port 80 from ALB only`
4. VPC: **default VPC**
5. Inbound rules:

| Type | Port | Source |
|---|---|---|
| HTTP | 80 | `pulse-alb-sg` (select the SG from Step 7) |

6. Outbound: leave default
7. **Create security group**

---

## Step 10 — ECS: Cluster

1. **ECS → Clusters → Create cluster**
2. Cluster name: `axiora-pulse-cluster`
3. Infrastructure: **AWS Fargate (serverless)** — uncheck EC2
4. Monitoring: enable **Container Insights** (optional but recommended)
5. **Create**

---

## Step 11 — ALB: Backend Target Group

**EC2 → Target Groups → Create target group**

1. Target type: **IP addresses**
2. Name: `pulse-backend-tg`
3. Protocol: **HTTP** | Port: **8000**
4. VPC: **default VPC**
5. Health check:
   - Protocol: **HTTP**
   - Path: `/health`
   - Healthy threshold: **3**
   - Unhealthy threshold: **3**
   - Timeout: **10**
   - Interval: **30**
6. **Next** → skip registering targets → **Create target group**

---

## Step 12 — ALB: Frontend Target Group

**EC2 → Target Groups → Create target group**

1. Target type: **IP addresses**
2. Name: `pulse-frontend-tg`
3. Protocol: **HTTP** | Port: **80**
4. VPC: **default VPC**
5. Health check:
   - Protocol: **HTTP**
   - Path: `/`
   - Healthy threshold: **3**
   - Unhealthy threshold: **3**
   - Timeout: **5**
   - Interval: **30**
6. **Next** → skip registering targets → **Create target group**

---

## Step 13 — ALB: Load Balancer

**EC2 → Load Balancers → Create load balancer → Application Load Balancer**

1. Name: `axiora-pulse-alb`
2. Scheme: **Internet-facing**
3. IP address type: **IPv4**
4. VPC: **default VPC**
5. Mappings: check **all 3 availability zones** (all default subnets)
6. Security groups: remove the default, add **`pulse-alb-sg`**
7. Listeners:
   - Add **HTTP : 80** → Action: **Redirect to HTTPS** (port 443, 301)
   - Add **HTTPS : 443** → Action: Forward to **`pulse-frontend-tg`**
8. **Create load balancer**

**Note the ALB DNS name** from the summary — e.g.:
```
axiora-pulse-alb-123456789.ap-south-1.elb.amazonaws.com
```
You will set this as the CloudFront origin in Steps 17 and 18.

---

## Step 14 — ACM (ap-south-1): SSL Certificate for ALB

> This certificate is attached to the ALB. CloudFront connects to the ALB over HTTPS and validates this cert.

1. **ACM → Request certificate** (make sure region is **ap-south-1**)
2. Certificate type: **Public**
3. Domain names — add all three:
   - `axiorapulse.com`
   - `www.axiorapulse.com`
   - `api.axiorapulse.com`
4. Validation method: **DNS validation**
5. **Request**
6. Click the pending certificate → **Create records in Route 53**  
   (or copy the CNAME records and add them in your DNS provider manually)
7. Wait for status: **Issued** (~5 minutes)

---

## Step 15 — ALB: HTTPS Listener + Backend Rule

### Attach the SSL certificate

1. **EC2 → Load Balancers → axiora-pulse-alb → Listeners**
2. Click **HTTPS : 443 → Edit**
3. Under **Secure listener settings**, add the ACM certificate from Step 14
4. **Save changes**

### Add backend host-based rule

1. **HTTPS : 443 → Manage rules → Add rule**
2. Name: `backend-host-rule`
3. Condition: **Host header** → `api.axiorapulse.com`
4. Action: **Forward to** `pulse-backend-tg`
5. Priority: **1**
6. **Save**

> The default rule (lowest priority) already forwards everything to `pulse-frontend-tg`.  
> Priority 1 means the backend rule is evaluated first.

---

## Step 16 — ACM (us-east-1): SSL Certificate for CloudFront

> CloudFront **requires** its SSL certificate to be in **N. Virginia (us-east-1)**, even though all other resources are in ap-south-1. This is an AWS requirement.

1. Switch your AWS Console region to **US East (N. Virginia) — us-east-1**
2. Go to **ACM → Request certificate**
3. Certificate type: **Public**
4. Domain names — add all three:
   - `axiorapulse.com`
   - `www.axiorapulse.com`
   - `api.axiorapulse.com`
5. Validation method: **DNS validation**
6. **Request**
7. Click the pending certificate → **Create records in Route 53**  
   (skip if you already added the same CNAME records in Step 14 — same records validate both certs)
8. Wait for status: **Issued** (~5 minutes)
9. **Switch your region back to ap-south-1** for all subsequent steps.

---

## Step 17 — CloudFront: Frontend Distribution

This distribution serves `axiorapulse.com` and `www.axiorapulse.com`.

1. **CloudFront → Distributions → Create distribution**

### Origin

| Field | Value |
|---|---|
| Origin domain | Your ALB DNS name (e.g. `axiora-pulse-alb-xxxx.ap-south-1.elb.amazonaws.com`) |
| Protocol | **HTTPS only** |
| HTTPS port | 443 |
| Minimum origin SSL protocol | **TLSv1.2** |
| Origin path | *(leave blank)* |
| Name | `axiorapulse-alb-frontend` |

### Default cache behavior

| Field | Value |
|---|---|
| Viewer protocol policy | **Redirect HTTP to HTTPS** |
| Allowed HTTP methods | **GET, HEAD, OPTIONS, PUT, POST, PATCH, DELETE** |
| Cache policy | **CachingDisabled** (safe default; tune later for static assets) |
| Origin request policy | **AllViewer** (forward all headers, cookies, query strings to origin) |

### Settings

| Field | Value |
|---|---|
| Alternate domain names (CNAMEs) | `axiorapulse.com` and `www.axiorapulse.com` (add both) |
| Custom SSL certificate | Select the **us-east-1** cert from Step 16 |
| Default root object | *(leave blank — Nginx serves index.html)* |
| IPv6 | Enabled |

2. **Create distribution**
3. **Note the CloudFront domain name** — e.g. `d1abc2def3gh4i.cloudfront.net`  
   Wait for the distribution status to change from **Deploying** to **Enabled** (~5–10 min).

---

## Step 18 — CloudFront: API Distribution

This distribution serves `api.axiorapulse.com`. API responses must **not** be cached.

1. **CloudFront → Distributions → Create distribution**

### Origin

| Field | Value |
|---|---|
| Origin domain | Same ALB DNS name as Step 17 |
| Protocol | **HTTPS only** |
| HTTPS port | 443 |
| Minimum origin SSL protocol | **TLSv1.2** |
| Name | `axiorapulse-alb-api` |

### Default cache behavior

| Field | Value |
|---|---|
| Viewer protocol policy | **Redirect HTTP to HTTPS** |
| Allowed HTTP methods | **GET, HEAD, OPTIONS, PUT, POST, PATCH, DELETE** |
| Cache policy | **CachingDisabled** |
| Origin request policy | **AllViewer** |

> **Important:** With `AllViewer`, the `Host` header forwarded to the ALB will be `api.axiorapulse.com`, which matches the host-based routing rule added in Step 15 and the ALB SSL certificate from Step 14.

### Settings

| Field | Value |
|---|---|
| Alternate domain names (CNAMEs) | `api.axiorapulse.com` |
| Custom SSL certificate | Select the **us-east-1** cert from Step 16 |

2. **Create distribution**
3. **Note the CloudFront domain name** — e.g. `d9xyz8abc7de6f.cloudfront.net`  
   Wait for the distribution to reach **Enabled** status.

---

## Step 19 — VPC: Lock ALB to CloudFront-Only Traffic

Once both CloudFront distributions are **Enabled**, restrict the ALB to accept traffic only from CloudFront. This prevents anyone from bypassing CloudFront and hitting the ALB directly.

1. **VPC → Security Groups → `pulse-alb-sg` → Edit inbound rules**
2. **Delete** the existing `0.0.0.0/0` rules for HTTP and HTTPS
3. **Add** two new inbound rules using the AWS-managed CloudFront prefix list:

| Type | Port | Source |
|---|---|---|
| HTTPS | 443 | `pl-f6a16f9f` *(search "cloudfront" in the prefix list dropdown — choose `com.amazonaws.global.cloudfront.origin-facing`)* |
| HTTP | 80 | `pl-f6a16f9f` *(same prefix list)* |

> The prefix list ID `pl-f6a16f9f` is the global CloudFront origin-facing prefix list. AWS maintains it automatically — you never need to update IP ranges manually.

4. **Save rules**

Verify: try accessing `https://axiora-pulse-alb-xxxx.ap-south-1.elb.amazonaws.com` directly in a browser — it should time out. Accessing via `https://axiorapulse.com` through CloudFront should still work.

---

## Step 20 — ECS: Register Task Definitions (CLI)

Run from the repository root with AWS CLI configured for `ap-south-1`:

```bash
# Backend task definition
aws ecs register-task-definition \
  --cli-input-json file://backend/ecs-task-def.json \
  --region ap-south-1

# Frontend task definition
aws ecs register-task-definition \
  --cli-input-json file://frontend/ecs-task-def.json \
  --region ap-south-1
```

Verify in **ECS → Task definitions** — you should see:
- `pulse-backend` at revision 1
- `pulse-frontend` at revision 1

---

## Step 21 — ECR: Push Initial Images (CLI)

ECS services need at least one image in ECR before they can start.  
Run from the repository root:

```bash
# Authenticate Docker to ECR
aws ecr get-login-password --region ap-south-1 | \
  docker login --username AWS --password-stdin \
  217757579310.dkr.ecr.ap-south-1.amazonaws.com

# ── Backend ──────────────────────────────────────────────────────────────────
docker build -f backend/Dockerfile.prod \
  -t 217757579310.dkr.ecr.ap-south-1.amazonaws.com/axiora/pulse-fastapi:latest \
  ./backend

docker push 217757579310.dkr.ecr.ap-south-1.amazonaws.com/axiora/pulse-fastapi:latest

# ── Frontend ─────────────────────────────────────────────────────────────────
docker build \
  --build-arg VITE_API_BASE_URL=https://api.axiorapulse.com \
  -t 217757579310.dkr.ecr.ap-south-1.amazonaws.com/axiora/pulse-frontend:latest \
  ./frontend

docker push 217757579310.dkr.ecr.ap-south-1.amazonaws.com/axiora/pulse-frontend:latest
```

---

## Step 22 — ECS: Backend Service

**ECS → Clusters → axiora-pulse-cluster → Services → Create**

1. Compute: **Launch type → Fargate**
2. Task definition family: `pulse-backend` | Revision: **LATEST**
3. Service name: `pulse-backend-service`
4. Desired tasks: **1**
5. Networking:
   - VPC: **default VPC**
   - Subnets: select **all 3**
   - Security group: **pulse-backend-sg** (remove the default)
   - Public IP: **Enabled**
6. Load balancing:
   - Type: **Application Load Balancer**
   - Load balancer: `axiora-pulse-alb`
   - Container: `pulse-backend : 8000`
   - Listener: **443 : HTTPS**
   - Target group: **pulse-backend-tg**
7. **Create service**

---

## Step 23 — ECS: Frontend Service

**ECS → Clusters → axiora-pulse-cluster → Services → Create**

1. Compute: **Launch type → Fargate**
2. Task definition family: `pulse-frontend` | Revision: **LATEST**
3. Service name: `pulse-frontend-service`
4. Desired tasks: **1**
5. Networking:
   - VPC: **default VPC**
   - Subnets: select **all 3**
   - Security group: **pulse-frontend-sg** (remove the default)
   - Public IP: **Enabled**
6. Load balancing:
   - Type: **Application Load Balancer**
   - Load balancer: `axiora-pulse-alb`
   - Container: `pulse-frontend : 80`
   - Listener: **443 : HTTPS**
   - Target group: **pulse-frontend-tg**
7. **Create service**

> Watch **ECS → Clusters → axiora-pulse-cluster → Services**.  
> Both services should show tasks going `PROVISIONING → PENDING → RUNNING` (~2–3 min).

---

## Step 24 — Route 53: Hosted Zone + GoDaddy Nameserver Delegation

`axiorapulse.com` is registered at GoDaddy. You will keep it there but delegate DNS management entirely to Route 53. GoDaddy becomes registration-only — all records live in AWS.

> **Why:** GoDaddy does not support CNAME flattening or ALIAS records. Without ALIAS support you cannot point the root apex domain (`axiorapulse.com`) to CloudFront — standard DNS forbids a CNAME on the apex. Route 53 ALIAS records solve this natively and cost ~$0.50/month for the hosted zone.

### 24a — Create the Route 53 Hosted Zone

1. **Route 53 → Hosted zones → Create hosted zone**
2. Domain name: `axiorapulse.com`
3. Type: **Public hosted zone**
4. **Create hosted zone**
5. Open the new hosted zone — note the **4 NS record values**, e.g.:
   ```
   ns-123.awsdns-45.com
   ns-678.awsdns-90.net
   ns-111.awsdns-22.org
   ns-999.awsdns-88.co.uk
   ```

Route 53 auto-creates an NS record and an SOA record. Do not delete them.

### 24b — Update Nameservers in GoDaddy

1. Log in to **GoDaddy → My Products → Domains → `axiorapulse.com` → DNS**
2. Click **Nameservers → Change Nameservers**
3. Select **I'll use my own nameservers**
4. Replace all existing nameservers with the **4 Route 53 NS values** from Step 24a
5. **Save** — GoDaddy shows a warning about losing existing DNS records; confirm it
6. Propagation takes **a few minutes to a few hours** (typically under 30 min)

> After this point all DNS for `axiorapulse.com` is controlled from Route 53. Any records previously in GoDaddy (MX for email, etc.) are gone — recreate them in Route 53 if needed.

### 24c — Verify Delegation

Once propagation is complete, confirm Route 53 is answering:

```bash
dig NS axiorapulse.com +short
# Should return the 4 awsdns-* nameservers from Step 24a
```

---

## Step 25 — DNS: Records in Route 53

With the hosted zone active, add three records. Use the CloudFront domain names you noted in Steps 17 and 18.

Go to **Route 53 → Hosted zones → axiorapulse.com → Create record**

| Record name | Type | Routing | Value |
|---|---|---|---|
| `axiorapulse.com` (root/apex) | **A** | **Alias → CloudFront distribution** | frontend distribution (Step 17) |
| `www` | **A** | **Alias → CloudFront distribution** | frontend distribution (Step 17) |
| `api` | **CNAME** | Simple | API CloudFront domain e.g. `d9xyz8abc7de6f.cloudfront.net` |

For the Alias records: when you choose **Alias → CloudFront distribution**, Route 53 shows a dropdown — select the frontend distribution. No TTL needed for Alias records.

DNS changes in Route 53 propagate within seconds to a few minutes globally.

---

## Step 26 — GitHub: Repository Secrets

Go to your GitHub repo → **Settings → Secrets and variables → Actions → New repository secret**

| Secret | Value |
|---|---|
| `AWS_ACCESS_KEY_ID` | ✅ already set |
| `AWS_SECRET_ACCESS_KEY` | ✅ already set |
| `VITE_API_BASE_URL` | `https://api.axiorapulse.com` |

> `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` have been removed — Supabase is no longer used.

---

## Verification

Once all steps are complete:

```bash
# Backend health check (through CloudFront)
curl https://api.axiorapulse.com/health
# Expected: {"status":"ok","service":"Nexora Pulse API"}

# Frontend (through CloudFront)
curl -I https://axiorapulse.com
# Expected: HTTP/2 200

# Confirm www redirect works
curl -I https://www.axiorapulse.com
# Expected: HTTP/2 200 (or 301 redirect to root, depending on Nginx config)

# Confirm direct ALB access is blocked (should time out after Step 19)
curl --max-time 5 https://axiora-pulse-alb-xxxx.ap-south-1.elb.amazonaws.com
# Expected: curl: (28) Operation timed out
```

In **ECS → Clusters → axiora-pulse-cluster → Services**:
- `pulse-backend-service` → **1/1 tasks running**
- `pulse-frontend-service` → **1/1 tasks running**

In **EC2 → Target Groups**:
- `pulse-backend-tg` → target status: **healthy**
- `pulse-frontend-tg` → target status: **healthy**

In **CloudFront → Distributions**:
- Frontend distribution → Status: **Enabled**, Domain: `axiorapulse.com`
- API distribution → Status: **Enabled**, Domain: `api.axiorapulse.com`

---

## After Setup: CI/CD is Automatic

Every `git push` to `main` triggers:

| Changed path | Workflow | What happens |
|---|---|---|
| `backend/**` | `deploy-backend.yml` | Builds with `Dockerfile.prod` → pushes to ECR → deploys to `pulse-backend-service` |
| `frontend/**` | `deploy-frontend.yml` | Builds with `VITE_API_BASE_URL=https://api.axiorapulse.com` → pushes to ECR → deploys to `pulse-frontend-service` |

Zero-downtime rolling updates are handled automatically by ECS.  
CloudFront automatically picks up new ECS responses — no cache invalidation needed (CachingDisabled policy).
