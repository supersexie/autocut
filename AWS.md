# Autocut on AWS: 100,000 jobs at once

Railway runs Autocut today (about 20 jobs at once, 100 at most on the Hobby plan). This is the setup
for very large numbers: the same code, run on AWS, with machines added and removed automatically.
Nothing here changes the Railway setup. The server only switches to this mode when `REDIS_URL` is set.

Everything is in the repo:

| Path | What it is |
|---|---|
| `infra/terraform/` | The AWS side as code: network, Kubernetes cluster (EKS), Karpenter, KEDA, load balancer controller, Redis, image registry |
| `infra/k8s/` | What runs in the cluster: API, cut workers, GPU export workers, GPU speech-to-text, PgBouncer, machine pools |
| `infra/deploy.sh` | Builds the three images, pushes them and rolls them out |
| `Dockerfile` | API and cut workers (same as Railway) |
| `Dockerfile.gpu` | Export worker that encodes on an NVIDIA GPU (NVENC) |
| `asr/` | Our own speech-to-text on GPUs (faster-whisper, Whisper large-v3) |

---

## 1. What runs where

**In short, who does what on AWS:**

- **Speech-to-text: our own GPU machines.** The `asr` service (`asr/`) runs Whisper large-v3, OpenAI's
  speech-recognition model, on NVIDIA GPU machines rented from AWS. Each GPU handles many videos at once,
  and more GPUs are added automatically as the list of waiting cuts grows. **Deepgram stays as the
  backup:** if our speech-to-text fails or is overloaded, that cut goes to Deepgram instead, so nothing
  breaks.
- **Cutting: CPU machines running our own code.** The cut workers are ordinary computers with no GPU. For
  each cut they:
  1. join the takes together;
  2. send the audio to speech-to-text and get the words back;
  3. find the ums, pauses and retakes with our own rules (`src/`, the same code as on Railway);
  4. save the result, which is pushed to the phone at once.

  They're also added and removed automatically with the number of cuts waiting.
- **Exports: the phone.** In the real app, every iPhone exports its own video, the same as on Railway. The
  GPU export workers are only the fallback, for Expo Go or an export that fails on the phone, so few are
  needed.
- **Before relying on our own speech-to-text:** compare it with Deepgram on real fast-talker videos, to check
  it keeps every "um" and repeat with the right times (§8). That's the one quality check that matters.

The full list:

| Piece | Runs on | Grows by |
|---|---|---|
| **API** (`ROLE=api`): what the app talks to, live progress on `/live` | CPU machines, behind an AWS load balancer (HTTPS, WebSockets) | CPU use (3 to 500 copies) |
| **Cut workers** (`WORKER_KINDS=cut`): join takes, read audio, find what to cut | CPU machines (spot when available) | KEDA: one copy per 8 cuts waiting or running |
| **Export workers** (`WORKER_KINDS=render,preview`): the fallback for exports the phone can't do (Expo Go, a failed phone export) and editor previews, encoded on the GPU | GPU machines (L4, A10G, L40S, T4) | KEDA: one copy (one GPU) per 6 exports |
| **Speech-to-text** (`asr/`): every word with its time, ums kept | GPU machines | KEDA: one GPU per 24 cuts |
| **Job list and live progress**: Redis (ElastiCache Valkey) | Managed by AWS, primary plus standby in another zone | Bigger machine (`redis_node_type`) |
| **PgBouncer**: shares a few database connections among thousands of workers | CPU machines | Fixed (3) |
| **Machines** | Karpenter starts the cheapest machine that fits whatever is waiting, and removes empty ones | Up to the limits in `infra/k8s/karpenter.yaml` |
| Accounts, cut records | **Supabase** (unchanged) | Supabase compute size |
| Videos | **Cloudflare R2** (unchanged) | No limit |
| Speech-to-text backup | **Deepgram** (unchanged): used if our own speech-to-text fails | Its account limit |

How a cut flows:
1. The phone uploads to R2 and asks the API for a cut. The API puts a job on the Redis list.
2. A cut worker claims it (never two workers on one job) and sends the audio to speech-to-text.
3. Each stage is pushed straight to the phone over the WebSocket.
4. Exports run on the phone. Only fallback exports go to a GPU export worker.
5. KEDA watches `GET /queue` and adds workers as the list grows. Karpenter adds machines for them.

---

## 2. Size for 100,000 at once

These are starting estimates, made before any load test. Measure on a staging load test and adjust
the numbers in `infra/k8s/workers.yaml` and `asr.yaml`.

| Per job | Uses |
|---|---|
| A cut | ½ vCPU (8 per 4-vCPU copy), plus 1/24 of a speech-to-text GPU |
| An export | 1/6 of a GPU plus 1 vCPU |

Example: 100,000 cuts at once. Exports run on the phones, so only a small share reach the servers; this
assumes 2,000 fallback exports at once.

| Pool | Copies | Hardware |
|---|---|---|
| Cut workers | 12,500 | ~50,000 vCPU |
| Speech-to-text | ~4,200 | ~4,200 GPUs |
| Export workers (fallback only) | ~330 | ~330 GPUs |
| **Total** | | **~4,500 GPUs, ~55,000 vCPU** |

Machines with 4 or 8 GPUs are allowed, so that's a few thousand machines rather than tens of thousands.

The job list: with `PROGRESS_MS=2000` (set in the worker files), 100,000 jobs make about 60,000 Redis
writes a second, which a `cache.r7g.2xlarge` primary handles. Each progress message goes only to the
API copy whose phone is watching that cut.

---

## 3. Limits to raise first (do this on day one)

New AWS accounts can start only a handful of GPU machines. Increases this large are reviewed by
AWS, can take days to weeks, and one region may not have this many GPUs free. So **ask early, and
plan on 2–4 regions** (section 7). Go to AWS console → **Service Quotas** → **Amazon EC2**, in each
region you'll use, and request:

| Quota | Ask for (per region, if split over 3) |
|---|---|
| Running On-Demand G and VT instances (vCPUs) | ~30,000 |
| All G and VT Spot Instance Requests (vCPUs) | ~30,000 |
| Running On-Demand Standard (A, C, D, H, I, M, R, T, Z) instances (vCPUs) | ~30,000 |
| All Standard (A, C, D, H, I, M, R, T, Z) Spot Instance Requests (vCPUs) | ~30,000 |

In the request, say what it's for ("video encoding and speech recognition for a consumer app,
autoscaled, peaks of N GPUs"). If you have an AWS account manager, involve them. Also raise the
**Karpenter limits** in `infra/k8s/karpenter.yaml` (`cpu`, `nvidia.com/gpu`) to match what you're granted.

Also:
- **Supabase**: thousands of workers each write each cut's stages. Move to a large compute size
  before launch. PgBouncer keeps the connection count small (3 × 80).
- **Supabase sign-in checks**: Project Settings → **JWT Keys** → move to the asymmetric signing keys,
  so the API verifies tokens itself instead of asking Supabase on every request.

---

## 4. One-time setup

You need: an AWS account, a domain you can add DNS records to, and on your computer the AWS CLI v2,
Terraform 1.6+, kubectl, and Docker (with buildx).

1. **AWS account and access.** Turn on MFA for the root user. In **IAM Identity Center**, create a user
   for yourself with `AdministratorAccess`. Then on your computer: `aws configure sso`, then
   `export AWS_PROFILE=<the profile name you chose>`.
2. **Certificate for the API address.** In **Certificate Manager (ACM)**, in the region you'll use, request
   a public certificate for `api.yourdomain.com`. Choose DNS validation and add the record it shows to your
   DNS. The load balancer finds it automatically.
3. **Create everything** (about 20 minutes):
   ```bash
   cd infra/terraform
   terraform init
   terraform apply            # add -var region=eu-west-1 for another region
   ```
4. **Connect kubectl:** run what `terraform output -raw kubeconfig_command` prints.
5. **Settings (the secret).** Make a file `aws.env` (never commit it):
   - The same variables as Railway's `autocut` service (see ACCOUNTS.md §3): Supabase, R2, Deepgram,
     payments, legal.
   - Plus these:
     ```
     REDIS_URL=<terraform output -raw redis_url>
     SUPABASE_DATABASE_URL=<Supabase → Connect → Session pooler URL, port 5432>
     DATABASE_URL=postgresql://<same user>:<same password>@pgbouncer.autocut.svc.cluster.local:5432/postgres?sslmode=disable
     DB_POOL=2
     ```
   - Leave out `RAILWAY_API_TOKEN` and `SCALE_POOLS` (KEDA does the scaling here).

   Then:
   ```bash
   kubectl create namespace autocut
   kubectl -n autocut create secret generic autocut-env --from-env-file=aws.env
   rm aws.env
   ```
   To change a setting later: edit, then `kubectl -n autocut create secret generic autocut-env --from-env-file=aws.env --dry-run=client -o yaml | kubectl apply -f -` and `kubectl -n autocut rollout restart deploy`.
6. **Deploy** (from the repo root):
   ```bash
   API_HOST=api.yourdomain.com infra/deploy.sh
   ```
   The first build takes a while: the speech-to-text image includes CUDA and the Whisper model, several GB.
7. **DNS:** `kubectl -n autocut get ingress api` shows the load balancer's address (`k8s-autocut-…elb.amazonaws.com`).
   Add a CNAME record `api` → that address.
8. **Check:** `curl https://api.yourdomain.com/health` should show:
   - `"storageOk":true`
   - `"deepgramOk":true`
   - `"asrOk":true`
   - `queued`/`running` counts

   The API's log (`kubectl -n autocut logs deploy/api`) says `Job list: redis`.
9. **Point the app at it:** set `EXPO_PUBLIC_API_URL=https://api.yourdomain.com` (EAS → environment
   variables, or `eas.json`), then ship an update. In `site/index.html`, set `LEGAL_BASE` to the same address.
10. **Railway:** once the app is on AWS, keep Railway as a staging copy or remove its services.

---

## 5. Shipping changes

Commit, then run `API_HOST=api.yourdomain.com infra/deploy.sh` again. Copies are replaced a few at a
time. A worker being replaced gets 10 minutes (`DRAIN_SECONDS=600`) to finish its jobs, then hands the
rest back to the list. `/health` shows the running commit (`version`). This can be moved into a
GitHub Action later.

---

## 6. Watching it

| What | How |
|---|---|
| Jobs waiting / running | `curl https://api.yourdomain.com/queue?kinds=cut` (or `render,preview`) |
| Copies of each pool | `kubectl -n autocut get deploy` and `kubectl -n autocut get scaledobject` |
| Machines | `kubectl get nodes -L autocut/pool,karpenter.sh/capacity-type,node.kubernetes.io/instance-type` |
| Why a pod is waiting | `kubectl -n autocut describe pod <name>` (usually: quota reached, or no spot/GPU free) |
| Logs | `kubectl -n autocut logs deploy/worker-cut --tail=100` |
| Speech-to-text load | `kubectl -n autocut exec deploy/asr -- python3 -c "import urllib.request;print(urllib.request.urlopen('http://localhost:8000/health').read())"` |

Set CloudWatch alarms (or any uptime tool) on `/health`, and on `queued` staying high for more than a
few minutes. That means a quota or the Karpenter limit has been reached.

---

## 7. More regions

Each region is a full copy: its own cluster, Redis, workers and load balancer. They share Supabase
and R2.

```bash
cd infra/terraform
terraform workspace new eu-west-1
terraform apply -var region=eu-west-1
```

Then repeat steps 2 and 4–6 for that region. Point DNS at all regions with **Route 53 latency
records**: one `api.yourdomain.com`, answered by the nearest region. A phone keeps talking to the same
region, so its cut's jobs and live progress stay in that region.

---

## 8. Speech-to-text: ours or Deepgram

The cut workers try our own GPU speech-to-text first (`ASR_URL`, set in `workers.yaml`). If it fails,
they use Deepgram, so keep `DEEPGRAM_API_KEY` set. Before relying on it, compare it with Deepgram on
the fast-talker takes. Check that every um and repeat is there with the right times.

To stay on Deepgram only, remove `ASR_URL` from `workers.yaml` and the `asr.yaml` line from
`kustomization.yaml`. Deepgram's per-account limit (about 50–100 at once) then caps cuts.

The model is `large-v3`, set with `ASR_MODEL` in `asr/Dockerfile`. `large-v3-turbo` is faster, but it
dropped punctuation in earlier tests. Locally it runs on CPU for testing:

```bash
cd asr && pip install -r requirements.txt
ASR_MODEL=small ASR_DEVICE=cpu python server.py
ASR_URL=http://localhost:8000 npm run server
```

---

## 9. New settings (all optional; without them the server behaves as on Railway)

| Setting | What it does |
|---|---|
| `REDIS_URL` | Use Redis for the job list and live progress (otherwise Postgres) |
| `ASR_URL`, `ASR_TOKEN`, `ASR_MAX` | Our own speech-to-text: address, optional password, requests at once per worker (16) |
| `VIDEO_ENCODER` | `libx264` (CPU, default), `h264_nvenc` (NVIDIA GPU), `h264_videotoolbox` (Mac) |
| `FFMPEG_PATH` | An ffmpeg other than the bundled one (the GPU image uses Debian's, which has NVENC) |
| `PROGRESS_MS` | How often a running job reports progress (1000; 2000 on AWS) |
| `DRAIN_SECONDS` | How long a stopping worker lets its jobs finish (20; 600 on AWS) |
| `SUPABASE_DATABASE_URL` | PgBouncer's connection to Supabase (AWS only) |
| `GIT_SHA` | Set by `deploy.sh`; shown as `version` on `/health` |

## 10. Before launch

- Load-test a staging copy: a separate region, bucket and Supabase project, with thousands of simulated
  uploads. Then adjust `CONCURRENCY` and the KEDA `targetValue`s. Use `nvidia-smi` on a GPU machine
  (`kubectl debug node/<name> -it --image=ubuntu`) to see how busy GPUs and NVENC are.
- Test one export on a real GPU machine and compare it with the Railway export. It should look the
  same, and the captions should match.
- Spot machines can be taken back with 2 minutes' notice. Karpenter moves the pods off. Jobs still
  running when the machine goes are put back on the list within about 2 minutes and start again
  elsewhere, so nothing is lost, only restarted. Test this once on staging.
