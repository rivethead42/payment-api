#!/usr/bin/env bash
# Docker build and ECR push for payment-api.
# Invoked from Jenkins: build.sh build | build.sh push
set -euo pipefail

: "${AWS_REGION:?AWS_REGION is required}"
: "${ECR_REGISTRY:?ECR_REGISTRY is required}"
: "${ECR_REPOSITORY:?ECR_REPOSITORY is required}"
: "${GIT_COMMIT:?GIT_COMMIT is required}"
: "${GIT_BRANCH:?GIT_BRANCH is required}"

SHORT_SHA="${GIT_COMMIT:0:7}"
BRANCH_SLUG="${GIT_BRANCH#origin/}"
BRANCH_SLUG="${BRANCH_SLUG//\//-}"

IMAGE_SHA="${ECR_REGISTRY}/${ECR_REPOSITORY}:${SHORT_SHA}"
IMAGE_BRANCH="${ECR_REGISTRY}/${ECR_REPOSITORY}:${BRANCH_SLUG}"

is_main_branch() {
    case "${GIT_BRANCH}" in
        main|master|origin/main|origin/master) return 0 ;;
        *) return 1 ;;
    esac
}

do_build() {
    : "${WORKSPACE:?WORKSPACE is required}"

    export BUILD_DATE="${BUILD_DATE:-$(date -u +"%Y-%m-%dT%H:%M:%SZ")}"

    echo "==> Building Docker image (app/Dockerfile)"
    docker build \
        --build-arg BUILD_DATE="${BUILD_DATE}" \
        --build-arg GIT_COMMIT="${GIT_COMMIT}" \
        -t "${IMAGE_SHA}" \
        -f app/Dockerfile \
        app

    docker tag "${IMAGE_SHA}" "${IMAGE_BRANCH}"

    if [[ -n "${IMAGE_NAME:-}" ]]; then
        docker tag "${IMAGE_SHA}" "${IMAGE_NAME}"
    fi

    if is_main_branch; then
        docker tag "${IMAGE_SHA}" "${ECR_REGISTRY}/${ECR_REPOSITORY}:latest"
        echo "==> Tagged latest (main/master branch)"
    fi

    local size
    size="$(docker image inspect "${IMAGE_SHA}" --format='{{.Size}}' 2>/dev/null || echo 0)"
    if command -v numfmt >/dev/null 2>&1; then
        echo "==> Image size: $(numfmt --to=iec "${size}")"
    else
        echo "==> Image size (bytes): ${size}"
    fi

    echo "==> Built tags:"
    echo "    ${IMAGE_SHA}"
    echo "    ${IMAGE_BRANCH}"
    if is_main_branch; then
        echo "    ${ECR_REGISTRY}/${ECR_REPOSITORY}:latest"
    fi
    [[ -n "${IMAGE_NAME:-}" ]] && echo "    ${IMAGE_NAME}"
}

do_push() {
    : "${ECR_REGISTRY:?ECR_REGISTRY is required}"

    echo "==> Logging in to ECR (${ECR_REGISTRY})"
    aws ecr get-login-password --region "${AWS_REGION}" | \
        docker login --username AWS --password-stdin "${ECR_REGISTRY}"

    echo "==> Pushing ${IMAGE_SHA}"
    docker push "${IMAGE_SHA}"

    echo "==> Pushing ${IMAGE_BRANCH}"
    docker push "${IMAGE_BRANCH}"

    if [[ -n "${IMAGE_NAME:-}" ]]; then
        echo "==> Pushing ${IMAGE_NAME}"
        docker push "${IMAGE_NAME}"
    fi

    if is_main_branch; then
        echo "==> Pushing latest"
        docker push "${ECR_REGISTRY}/${ECR_REPOSITORY}:latest"
    fi

    echo "==> ECR push complete"
}

ACTION="${1:-}"
case "${ACTION}" in
    build) do_build ;;
    push)  do_push ;;
    *)
        echo "Usage: $0 {build|push}" >&2
        exit 1
        ;;
esac
