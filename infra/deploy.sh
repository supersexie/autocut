#!/usr/bin/env bash
# Builds the three images, pushes them to ECR and rolls them out to the cluster. From the repo root:
#   API_HOST=api.yourdomain.com infra/deploy.sh
# Needs: aws (signed in), docker, kubectl (pointed at the cluster), terraform (already applied).
set -euo pipefail
cd "$(dirname "$0")/.."
: "${API_HOST:?set API_HOST to the API address, e.g. api.yourdomain.com}"
TF="terraform -chdir=infra/terraform"
REGION=$($TF output -raw region)
REGISTRY=$($TF output -raw ecr_registry)
SHA=$(git rev-parse --short HEAD)

aws ecr get-login-password --region "$REGION" | docker login --username AWS --password-stdin "$REGISTRY"
build() { docker buildx build --platform linux/amd64 -f "$2" -t "$REGISTRY/autocut/$1:$SHA" --push "$3"; }
build server Dockerfile .
build server-gpu Dockerfile.gpu .
build asr asr/Dockerfile asr

kubectl kustomize infra/k8s |
  sed -e "s#ACCOUNT.dkr.ecr.REGION.amazonaws.com#$REGISTRY#g" \
      -e "s#\(autocut/[a-z-]*\):latest#\1:$SHA#g" \
      -e "s#api.example.com#$API_HOST#g" \
      -e "s#__GIT_SHA__#\"$SHA\"#g" |
  kubectl apply -f -
kubectl -n autocut rollout status deploy/api --timeout=10m
echo "Deployed $SHA. Check: curl https://$API_HOST/health"
