# kube-prometheus-stack on AWS EKS

Production-ready manifests to deploy **Prometheus** and **Grafana** in the `monitoring` namespace using the [kube-prometheus-stack](https://github.com/prometheus-community/helm-charts/tree/main/charts/kube-prometheus-stack) Helm chart.

Both UIs are exposed publicly via Kubernetes `LoadBalancer` Services (AWS Classic ELB or NLB). Persistent storage uses the `gp2` or `gp3` EBS StorageClass.

| File | Purpose |
|------|---------|
| `namespace.yaml` | Creates the `monitoring` namespace |
| `grafana-secret.yaml` | Grafana admin credentials (Kubernetes Secret) |
| `values.yaml` | Helm values for kube-prometheus-stack |
| `dashboards/payment-api.json` | Grafana dashboard for the Node.js payment API |
| `kustomization.yaml` | Namespace, secret, and dashboard ConfigMap (sidecar auto-import) |
| `../servicemonitor.yaml` | Scrapes `payment-api` `/metrics` via the Prometheus Operator |

Before deploying, replace all `[PLACEHOLDER]` values in `values.yaml` and `grafana-secret.yaml` (see [Placeholder values](#placeholder-values)).

## 1. AWS prerequisites

The following must be in place **before** running the apply commands below.

### EBS CSI driver

PersistentVolumeClaims for Prometheus (50Gi) and Grafana (10Gi) require a working EBS CSI driver. This repository's Terraform module installs the `aws-ebs-csi-driver` EKS addon with IRSA. Without it, PVCs remain in `Pending`.

Confirm the driver is running:

```bash
kubectl get pods -n kube-system -l app.kubernetes.io/name=aws-ebs-csi-driver
```

### StorageClass

A `gp3` (recommended) or `gp2` StorageClass must exist and match `[STORAGE_CLASS_NAME]` in `values.yaml`.

```bash
kubectl get storageclass
```

If no suitable class exists, create `gp3`:

```bash
kubectl apply -f - <<EOF
apiVersion: storage.k8s.io/v1
kind: StorageClass
metadata:
  name: gp3
provisioner: ebs.csi.aws.com
parameters:
  type: gp3
  fsType: ext4
volumeBindingMode: WaitForFirstConsumer
allowVolumeExpansion: true
EOF
```

### Load balancer provisioning

EKS must be able to provision AWS Classic ELB or Network Load Balancers for `Service` type `LoadBalancer`. This requires either:

- The in-tree AWS cloud provider (default on EKS), or
- The [AWS Load Balancer Controller](https://kubernetes-sigs.github.io/aws-load-balancer-controller/)

Public subnets used by the cluster should be tagged for ELB placement (`kubernetes.io/role/elb` for internet-facing load balancers).

Optional NLB annotations are documented in `values.yaml` under `grafana.service` and `prometheus.service`.

### IAM and security groups

- The EKS cluster IAM role must allow ELB/NLB creation.
- Node security groups must permit inbound traffic from the load balancer to Prometheus (port 9090) and Grafana (port 80).

### Client tooling

- `kubectl` configured for the target EKS cluster
- **Helm 3.8+** (required if installing from the OCI chart registry)

### Security note

Prometheus and Grafana are exposed on public LoadBalancers without built-in authentication on the Prometheus UI. Restrict access with `loadBalancerSourceRanges`, a VPN, or an authentication proxy before using in production.

## 2. Placeholder values

| Placeholder | File | What to supply |
|-------------|------|----------------|
| `[STORAGE_CLASS_NAME]` | `values.yaml` | EBS StorageClass name (`gp3` or `gp2`) |
| `[CLUSTER_NAME]` | `values.yaml` | EKS cluster name for Prometheus `externalLabels` |
| `[PLACEHOLDER_ADMIN_USER]` | `grafana-secret.yaml` | Base64-encoded Grafana admin username |
| `[PLACEHOLDER_ADMIN_PASSWORD]` | `grafana-secret.yaml` | Base64-encoded strong admin password |

Generate base64 values for the Grafana secret:

```bash
echo -n 'admin' | base64
echo -n '<your-strong-password>' | base64
```

Replace the `data` fields in `grafana-secret.yaml` before applying.

## 3. Apply order

Run commands in this sequence. Do not install the Helm chart before the namespace and secret exist.

```bash
# 0. Confirm kubectl context points at the target EKS cluster
kubectl config current-context

# 1. Create namespace, Grafana admin Secret, and Payment API dashboard ConfigMap
#    (replace base64 values in grafana-secret.yaml first)
kubectl apply -k k8s/monitoring/

# 3. Add Helm repo and pull latest chart metadata
helm repo add prometheus-community https://prometheus-community.github.io/helm-charts
helm repo update

# 4. Install kube-prometheus-stack (after editing placeholders in values.yaml)
helm install kube-prometheus prometheus-community/kube-prometheus-stack \
  --namespace monitoring \
  --values k8s/monitoring/values.yaml \
  --wait \
  --timeout 15m
```

**OCI alternative** (also supported by chart maintainers):

```bash
helm install kube-prometheus oci://ghcr.io/prometheus-community/charts/kube-prometheus-stack \
  --namespace monitoring \
  --values k8s/monitoring/values.yaml \
  --wait \
  --timeout 15m
```

## 4. Scrape payment-api metrics

The payment API exposes Prometheus metrics at `/metrics` on the `http` Service port (Express + `prom-client`). After kube-prometheus-stack is running and the payment API is deployed (`kubectl apply -k k8s/`), apply the ServiceMonitor:

```bash
kubectl apply -f k8s/servicemonitor.yaml
```

The ServiceMonitor lives in the `monitoring` namespace (where Prometheus runs) and uses a `namespaceSelector` to target the `payment-api` Service in the `payment-api` namespace. It carries `release: kube-prometheus` so it matches the Helm release name used in [Apply order](#3-apply-order).

| ServiceMonitor field | Value | Source |
|----------------------|-------|--------|
| Target namespace | `payment-api` | `k8s/deployment.yaml` |
| Service selector | `app: payment-api` | `k8s/service.yaml` |
| Port | `http` (Service port 80 → pod 3000) | `k8s/service.yaml` |
| Path | `/metrics` | `app/src/app.ts` |
| Scrape interval / timeout | 15s / 10s | `k8s/servicemonitor.yaml` |

`values.yaml` sets `serviceMonitorSelectorNilUsesHelmValues: false`, so Prometheus discovers ServiceMonitors cluster-wide. The `release` label is still recommended for compatibility with default kube-prometheus-stack selectors.

## 5. Payment API Grafana dashboard

A custom dashboard (`dashboards/payment-api.json`) is provisioned via a labeled ConfigMap. The Grafana sidecar in kube-prometheus-stack watches for ConfigMaps with `grafana_dashboard: "1"` and imports them automatically.

```bash
# Included in kubectl apply -k k8s/monitoring/ ; re-apply after editing the JSON:
kubectl apply -k k8s/monitoring/

# Confirm the ConfigMap exists
kubectl get configmap grafana-dashboard-payment-api -n monitoring --show-labels
```

Open Grafana → **Dashboards** → search for **Payment API** (uid: `payment-api-nodejs`).

| Section | Panels |
|---------|--------|
| Overview | Pods UP, request rate, 5xx error rate, p99 latency, circuit breaker, heap % |
| HTTP Traffic | Request rate by route, status code breakdown |
| HTTP Latency | Aggregate p50/p90/p99, p99 per route |
| Node.js Runtime | Event loop lag, GC rate/duration, active handles/requests |
| Memory | Heap/external, RSS/virtual, heap space breakdown |
| Process & Payment Processor | CPU, file descriptors, uptime, connection pool, circuit state |

Template variables filter by **namespace**, **pod**, and **route**. Operational endpoints (`/health`, `/metrics`) are excluded from overview and latency panels by default via the **Exclude routes** variable.

## 6. Verification

### Stack health

```bash
# Pods Running (PVC binding and LB provisioning may take a few minutes)
kubectl get pods -n monitoring -o wide

# PVCs bound
kubectl get pvc -n monitoring

# LoadBalancer hostnames / external IPs
kubectl get svc -n monitoring -l "app.kubernetes.io/name in (grafana,prometheus)"

# Grafana admin username
kubectl get secret grafana-admin-credentials -n monitoring \
  -o jsonpath='{.data.admin-user}' | base64 -d && echo
```

### payment-api scrape target

```bash
# ServiceMonitor present and labeled
kubectl get servicemonitor payment-api -n monitoring --show-labels

# payment-api Service has endpoints
kubectl get endpoints payment-api -n payment-api

# Metrics reachable through the cluster Service
kubectl run curl-test --rm -it --restart=Never --image=curlimages/curl:latest -- \
  curl -s http://payment-api.payment-api.svc.cluster.local/metrics | head -20

# Prometheus targets UI (port-forward if LB is not ready)
kubectl port-forward -n monitoring svc/kube-prometheus-prometheus 9090:9090
# Open http://localhost:9090/targets — look for serviceMonitor/monitoring/payment-api
```

In the Prometheus UI, confirm the payment-api target is **UP**, then query:

```promql
up{job=~".*payment-api.*"}
http_requests_total{namespace="payment-api"}
```

Expected scrape targets include **node-exporter**, **kube-state-metrics**, **kubelet** (cAdvisor), **coredns**, **kubernetes-pods-annotated** (for pods with `prometheus.io/scrape: "true"` annotations), and **payment-api** (via ServiceMonitor).

## 7. Troubleshooting ServiceMonitor discovery

**Missing `release` label** — If Prometheus uses `serviceMonitorSelector.matchLabels.release`, the ServiceMonitor must include `release: kube-prometheus` (the Helm release name). Check with:

```bash
kubectl get prometheus -n monitoring -o jsonpath='{.items[0].spec.serviceMonitorSelector}' && echo
kubectl get servicemonitor payment-api -n monitoring --show-labels
```

**Service label mismatch** — The ServiceMonitor `spec.selector` matches **Service** labels, not pod labels. Compare:

```bash
kubectl get svc payment-api -n payment-api --show-labels
kubectl get servicemonitor payment-api -n monitoring -o jsonpath='{.spec.selector}' && echo
```

**Wrong port name or namespace** — The endpoint `port` must match a named port on the Service (`http`, not `3000` or `80`). Confirm `namespaceSelector` includes `payment-api`:

```bash
kubectl get svc payment-api -n payment-api -o jsonpath='{.spec.ports[*].name}' && echo
kubectl describe servicemonitor payment-api -n monitoring
```
