#!/usr/bin/env bash
# Roll back payment-api deployment to the previous ReplicaSet revision.
set -euo pipefail

: "${WORKSPACE:?WORKSPACE is required}"
: "${AWS_REGION:?AWS_REGION is required}"
: "${K8S_NAMESPACE:?K8S_NAMESPACE is required}"
: "${DEPLOYMENT_NAME:?DEPLOYMENT_NAME is required}"

KUBECONFIG_PATH="${WORKSPACE}/.kubeconfig"
if [[ ! -f "${KUBECONFIG_PATH}" ]]; then
    echo "ERROR: kubeconfig not found at ${KUBECONFIG_PATH}" >&2
    exit 1
fi

export AWS_DEFAULT_REGION="${AWS_REGION}"
export KUBECONFIG="${KUBECONFIG_PATH}"

echo "==> Rolling back deployment/${DEPLOYMENT_NAME} in ${K8S_NAMESPACE}"
kubectl rollout undo "deployment/${DEPLOYMENT_NAME}" -n "${K8S_NAMESPACE}"

kubectl rollout status "deployment/${DEPLOYMENT_NAME}" \
    -n "${K8S_NAMESPACE}" \
    --timeout=5m

echo "==> Current container image:"
kubectl get deployment "${DEPLOYMENT_NAME}" -n "${K8S_NAMESPACE}" \
    -o jsonpath='{.spec.template.spec.containers[0].image}{"\n"}'
