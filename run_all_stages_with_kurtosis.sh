#!/bin/bash

set -e


DOCKER_IMAGE_NAME="hh-runner" #
export RESULTS_DIR_HOST="$PWD/hardhat/results"
export HH_PRIVATE_KEY="${PRIVATE_KEY:-12d7de8621a77640c9241b2595ba78ce443d05e94090365ab3bb5e19df82c625}" #
export HH_CHAIN_ID="${CHAIN_ID:-10101}" #

cleanup_kurtosis() {
  echo "🧹 Cleaning up Kurtosis enclave..."
  kurtosis clean --all || echo "Failed to remove enclave, it might not exist." #
}

trap cleanup_kurtosis SIGINT SIGTERM

echo "🔄 Removing previous Kurtosis enclave (if any)..."
cleanup_kurtosis #

echo "🚀 Starting Kurtosis enclave:."
kurtosis_run_cmd="kurtosis run --enclave cdk github.com/0xPolygon/kurtosis-cdk"


eval "${kurtosis_run_cmd}"
echo "✅ Kurtosis enclavestarted."

echo "🔗 Fetching Erigon RPC URL from Kurtosis..."


CDK_ERIGON_RPC_URL="$(kurtosis port print cdk cdk-erigon-rpc-001 rpc)"
export CDK_ERIGON_RPC_URL="$CDK_ERIGON_RPC_URL"
echo "✅ Erigon RPC URL for Hardhat container: ${CDK_ERIGON_RPC_URL}"

mkdir -p "${RESULTS_DIR_HOST}" #
echo "Host results directory: ${RESULTS_DIR_HOST}"

echo "🛠️ Building Hardhat Docker image: ${DOCKER_IMAGE_NAME}..."
docker build -t "${DOCKER_IMAGE_NAME}" -f ./Dockerfile .
echo "✅ Hardhat Docker image built."

echo "🐳 Running Hardhat stages in Docker container..."
docker run --rm --network="host" \
  -v "${RESULTS_DIR_HOST}:/usr/src/app/results" \
  -e CDK_ERIGON_RPC_URL="${CDK_ERIGON_RPC_URL}" \
  -e PRIVATE_KEY="${HH_PRIVATE_KEY}" \
  -e CHAIN_ID="${HH_CHAIN_ID}" \
  "${DOCKER_IMAGE_NAME}"

echo "✅ Hardhat stages execution finished. Results should be in ${RESULTS_DIR_HOST}/results.json"

cleanup_kurtosis 

echo "🎉 All done!"
