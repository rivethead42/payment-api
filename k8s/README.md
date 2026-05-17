# payment-api Kubernetes manifests

Production-ready manifests for the Node.js payment API on AWS EKS. External traffic enters only through a `LoadBalancer` Service (no Ingress).

**Notes:**

- Pod security context uses UID **1001** to match the container image (`appuser` in the Dockerfile).
- Liveness and readiness probes use **`/health`** (not `/ready`).

## 1. Prerequisites

- `kubectl` configured for **demo-eks-cluster** (or your target context)
- EKS can provision AWS load balancers for `Service` type `LoadBalancer` (default cloud controller)
- Container image pushed to ECR: `337748711987.dkr.ecr.us-east-1.amazonaws.com/payment-api:latest`
- **metrics-server** (or equivalent) installed on the cluster for HPA resource metrics

## 2. Apply everything

```bash
kubectl apply -k k8s/
```

## 3. Apply individual files

```bash
kubectl apply -f k8s/namespace.yaml
kubectl apply -f k8s/configmap.yaml
kubectl apply -f k8s/deployment.yaml
kubectl apply -f k8s/service.yaml
kubectl apply -f k8s/hpa.yaml
kubectl apply -f k8s/pdb.yaml
```

## 4. Deployment status

```bash
kubectl rollout status deployment/payment-api -n payment-api
```

## 5. LoadBalancer hostname (no Ingress)

```bash
kubectl get svc payment-api -n payment-api
```

Wait until `EXTERNAL-IP` or `hostname` is assigned, then access the API on port 80.

## 6. Pods

```bash
kubectl get pods -n payment-api
```

## 7. Logs

```bash
kubectl logs -l app=payment-api -n payment-api --follow
```

## 8. Rolling image update

```bash
kubectl set image deployment/payment-api \
  payment-api=337748711987.dkr.ecr.us-east-1.amazonaws.com/payment-api:<new-tag> \
  -n payment-api
```
