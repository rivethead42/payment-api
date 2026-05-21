#!/usr/bin/env bash
# Deploy payment-api to EKS using Kustomize. Does NOT run aws eks update-kubeconfig.
set -euo pipefail

: "${WORKSPACE:?WORKSPACE is required}"
: "${AWS_REGION:?AWS_REGION is required}"
: "${K8S_NAMESPACE:?K8S_NAMESPACE is required}"
: "${DEPLOYMENT_NAME:?DEPLOYMENT_NAME is required}"
: "${IMAGE_NAME:?IMAGE_NAME is required}"

KUBECONFIG_PATH="${WORKSPACE}/.kubeconfig"
if [[ ! -f "${KUBECONFIG_PATH}" ]]; then
    echo "ERROR: kubeconfig not found at ${KUBECONFIG_PATH}. Run the Configure kubeconfig stage first." >&2
    exit 1
fi

export AWS_DEFAULT_REGION="${AWS_REGION}"
export KUBECONFIG="${KUBECONFIG_PATH}"

echo "==> Patching image to ${IMAGE_NAME}"
cd "${WORKSPACE}/k8s"
kustomize edit set image "payment-api=${IMAGE_NAME}"

echo "==> Applying manifests"
kubectl apply -k "${WORKSPACE}/k8s/"

echo "==> Waiting for rollout"
kubectl rollout status "deployment/${DEPLOYMENT_NAME}" \
    -n "${K8S_NAMESPACE}" \
    --timeout=5m

echo "==> LoadBalancer endpoint"
LB_HOST="$(kubectl get svc payment-api -n "${K8S_NAMESPACE}" \
    -o jsonpath='{.status.loadBalancer.ingress[0].hostname}{.status.loadBalancer.ingress[0].ip}' 2>/dev/null || true)"
if [[ -n "${LB_HOST}" ]]; then
    echo "    http://${LB_HOST}/"
else
    echo "    (pending — LoadBalancer not ready yet)"
    kubectl get svc payment-api -n "${K8S_NAMESPACE}"
fi
