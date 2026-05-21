# Jenkins CI/CD — payment-api

Production-ready Declarative Pipeline and Job DSL seed job for building the Node.js 24 TypeScript API, pushing to AWS ECR, and deploying to EKS (`demo-eks-cluster`, namespace `payment-api`).

| Item | Value |
|------|--------|
| EKS cluster | `demo-eks-cluster` (`us-east-1`) |
| ECR repository | `payment-api` (registry built from `ecr-account-id` credential) |
| K8s manifests | `k8s/` (Kustomize) |
| Pipeline job | `payment-api/payment-api-pipeline` |
| Jenkinsfile | `jenkins/Jenkinsfile` |

---

## 1. Prerequisites

### Jenkins

- Jenkins **2.400+**
- Agent with **Docker** (socket access), **kubectl** 1.35+, **Kustomize**, **AWS CLI v2**, **Node.js 24**, and **curl**

### Required plugins

| Plugin | Purpose |
|--------|---------|
| Job DSL | Seed job (`seed.groovy`) |
| Pipeline / workflow-aggregator | Declarative pipeline |
| Git | SCM checkout |
| Credentials Binding | `withCredentials` |
| GitHub plugin | `githubPush()` trigger |
| Timestamper | `timestamps()` option |
| JUnit | Test result publishing |
| AWS Steps (optional) | AWS helpers |

Optional: Blue Ocean, HTML Publisher.

### Jenkins credentials (global)

| ID | Type | Usage |
|----|------|--------|
| `aws-credentials` | Username/Password | `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` — ECR, EKS exec auth |
| `eks-kubeconfig` | Secret file | Copied once per build to `${WORKSPACE}/.kubeconfig` |
| `ecr-account-id` | Secret text | AWS account ID for `ECR_REGISTRY` URL |
| `github-token` | Username/Password | Git clone (username = GitHub user, password = PAT) |
| `slack-webhook-url` | Secret text | Optional failure/unstable alerts |

### IAM (Jenkins user)

- ECR: push/pull on repository `payment-api`
- EKS: cluster access via `aws-auth` / EKS access entries (for `kubectl`)
- `eks:DescribeCluster` if you regenerate kubeconfig locally

---

## 2. First-time setup

### 2.1 Agent tools

```bash
# Docker socket for jenkins user
sudo usermod -aG docker jenkins
sudo systemctl restart jenkins
sudo -u jenkins docker ps

# Verify CLI tools on the agent
docker --version
kubectl version --client
kustomize version
aws --version
node --version   # expect v24.x
curl --version
```

### 2.2 Create credentials

#### `ecr-account-id`

Secret text with your AWS account ID (e.g. `337748711987`).

#### `aws-credentials`

Username/Password credential mapping to IAM access key and secret for the Jenkins deploy user.

#### `eks-kubeconfig` (Secret file)

Generate **outside Jenkins** with the **same IAM user** as `aws-credentials`:

```bash
export AWS_REGION=us-east-1
export EKS_CLUSTER_NAME=demo-eks-cluster

aws eks update-kubeconfig \
  --region "${AWS_REGION}" \
  --name "${EKS_CLUSTER_NAME}" \
  --kubeconfig eks-kubeconfig.yaml

export KUBECONFIG="$(pwd)/eks-kubeconfig.yaml"
export AWS_DEFAULT_REGION="${AWS_REGION}"
kubectl cluster-info
kubectl get nodes
```

Upload `eks-kubeconfig.yaml` in Jenkins: **Manage Jenkins → Credentials → Add → Secret file**, ID **`eks-kubeconfig`**.

Verify access with Jenkins keys:

```bash
export AWS_ACCESS_KEY_ID="<key>"
export AWS_SECRET_ACCESS_KEY="<secret>"
export AWS_DEFAULT_REGION=us-east-1
export KUBECONFIG="$(pwd)/eks-kubeconfig.yaml"
kubectl auth can-i get pods -n payment-api
```

Do **not** commit `eks-kubeconfig.yaml`.

#### `github-token`

1. GitHub → **Settings → Developer settings → Personal access tokens**
2. Classic token with **`repo`** scope (or fine-grained: Contents + Metadata read on `payment-api`)
3. Jenkins → **Username with password**, ID **`github-token`**, username = GitHub login, password = PAT

Verify clone:

```bash
git ls-remote "https://${GITHUB_USER}:${GITHUB_TOKEN}@github.com/rivethead42/payment-api.git" HEAD
```

Update the repo URL in `jenkins/seed.groovy` if your fork/org differs.

### 2.3 Run the seed job

1. Create a **Freestyle** or **Pipeline** seed job that runs the Job DSL plugin against `jenkins/seed.groovy` from SCM, **or** paste `seed.groovy` into a **Job DSL** seed job.
2. Build the seed job once.
3. Confirm job **`payment-api/payment-api-pipeline`** exists.

### 2.4 GitHub webhook

Repo **Settings → Webhooks → Add webhook**:

- Payload URL: `https://<jenkins-url>/github-webhook/`
- Content type: `application/json`
- Events: **Just the push event**
- Branch filter: pushes to **`main`** (handled by Jenkins GitHub trigger + `*/main` SCM branch spec)

The webhook does not use `github-token`; the token is for **git fetch/clone** only.

### 2.5 Optional Slack

Add secret text credential **`slack-webhook-url`**. If missing, the pipeline logs a skip message and continues.

---

## 3. Pipeline flow

```
┌─────────────┐     ┌──────────────────┐     ┌─────────────────┐
│  Checkout   │────▶│ Lint & validate  │────▶│ Build Docker    │
│  (SCM)      │     │ npm ci/tsc/lint  │     │ app/Dockerfile  │
└─────────────┘     │ test (app/)      │     └────────┬────────┘
                    └──────────────────┘              │
                                                        ▼
┌─────────────┐     ┌──────────────────┐     ┌─────────────────┐
│  Rollback   │◀────│  Smoke test      │◀────│ Security scan   │
│  (on fail)  │     │ curl /health     │     │ Trivy CRITICAL  │
└──────▲──────┘     └────────▲─────────┘     └────────┬────────┘
       │                     │                          │
       │              ┌──────┴───────┐                  ▼
       │              │ Deploy EKS   │         ┌─────────────────┐
       └──────────────│ kustomize+k  │◀────────│ Push to ECR     │
                      │ rollout      │         │ (catchError)    │
                      └──────▲───────┘         └────────┬────────┘
                             │                          │
                      ┌──────┴───────┐                  │
                      │ Configure    │◀─────────────────┘
                      │ kubeconfig   │  (skip if push failed)
                      │ (copy once)  │
                      └──────────────┘
```

**Triggers:** GitHub push to `main`, nightly cron `H 2 * * *`, manual build with parameters.

---

## 4. Manual deployment

1. Open **`payment-api/payment-api-pipeline`** → **Build with Parameters**
2. Set **`IMAGE_TAG`** to an existing tag in ECR (e.g. `abc1234`) to deploy that image without relying on the current commit SHA tag.
3. Leave **`IMAGE_TAG`** as `latest` on normal builds to use the short Git SHA from the checked-out commit.
4. **`SKIP_TESTS`**: `true` only for approved hotfixes.
5. **`DEPLOY_ENV`**: `prod` (reserved for future environments).

---

## 5. Rollback

| Type | Action |
|------|--------|
| **Automatic** | On deploy or smoke-test failure, `ROLLBACK_NEEDED` is set and the **Rollback** stage runs `jenkins/scripts/rollback.sh` |
| **Manual** | `kubectl rollout undo deployment/payment-api -n payment-api` |

```bash
export KUBECONFIG=/path/to/eks-kubeconfig.yaml
export AWS_DEFAULT_REGION=us-east-1
kubectl rollout undo deployment/payment-api -n payment-api
kubectl rollout status deployment/payment-api -n payment-api --timeout=5m
```

---

## 6. Troubleshooting

| Symptom | Likely cause | Fix |
|---------|--------------|-----|
| `permission denied` on `docker.sock` | Jenkins user not in `docker` group | `sudo usermod -aG docker jenkins` && restart Jenkins |
| `open Dockerfile: no such file` | Wrong build context | Build uses `-f app/Dockerfile` and context `app` |
| `Unable to locate credentials` on `kubectl` | Missing `aws-credentials` in stage | Ensure `withCredentials` + `AWS_DEFAULT_REGION` in that stage |
| `cp: Permission denied` on `.kubeconfig` | Re-copying kubeconfig after kubectl | Copy only in **Configure kubeconfig**; later stages only `export KUBECONFIG` |
| `Expected a step` at `try {` | `try/catch` outside `script {}` in `post {}` | Wrap Slack/notify logic in `script { try { ... } catch ... }` |
| `Unable to connect to the server` | Missing/stale `eks-kubeconfig` | Regenerate with `aws eks update-kubeconfig` and re-upload |
| `Authentication failed` / `403` on checkout | Bad/missing `github-token` | New PAT with `repo` scope; correct username + PAT password |
| `Could not find credentials ... github-token` | Credential ID mismatch | Create credential with exact ID `github-token` |
| Trivy CRITICAL findings | Vulnerable base/packages | Fix Dockerfile/deps; rebuild |
| LoadBalancer smoke test timeout | NLB/ELB still provisioning | Re-run pipeline or wait and hit `/health` manually |

---

## File layout

```text
jenkins/
├── seed.groovy           # Job DSL — creates payment-api/payment-api-pipeline
├── Jenkinsfile           # Declarative pipeline
├── README.md             # This file
└── scripts/
    ├── build.sh          # docker build + ECR push
    ├── deploy.sh         # kustomize + kubectl apply
    └── rollback.sh       # kubectl rollout undo
```

---

## Repository paths used by the pipeline

| Path | Role |
|------|------|
| `app/` | `npm ci`, `tsc`, lint, tests |
| `app/Dockerfile` | Multi-stage image build |
| `k8s/` | Kustomize manifests (`kubectl apply -k k8s/`) |

External access is via **LoadBalancer** Service `payment-api` — no Ingress in this demo.
