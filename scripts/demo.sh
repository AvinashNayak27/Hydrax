#!/usr/bin/env bash
set -euo pipefail
base_url="${BASE_URL:-http://localhost:3000}"
namespace="${1:-blastcut-demo}"
header=(-H "X-Graph-Namespace: ${namespace}")
printf '%s\n' '--- during incident ---'
curl -fsS "${base_url}/v1/analysis?phase=during&maxLen=16" "${header[@]}"
printf '\n%s\n' '--- deterministic containment plan ---'
curl -fsS "${base_url}/v1/containment?phase=during" "${header[@]}"
printf '\n%s\n' '--- counterfactual verification ---'
curl -fsS "${base_url}/v1/verify?phase=during" "${header[@]}"
printf '\n'
