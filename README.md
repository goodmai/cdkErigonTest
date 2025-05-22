# Hardhat EVM Interaction Project (Docker + Kurtosis)

This project uses Hardhat (inside a Docker container) to interact with the Ethereum Virtual Machine (EVM). It executes a three-stage task:

1.  **Stage 1:** Direct invocation of the `sha256` precompile (address `0x02`).
2.  **Stage 2:** Deployment of the `Ballot.sol` smart contract.
3.  **Stage 3:** Interaction with the deployed `Ballot.sol` contract (e.g., giving voting rights, voting, determining the winner).

An Ethereum node (specifically `cdk-erigon`) is managed using Kurtosis. The results of each stage are logged to `hardhat/results/results.json`.

## Project Structure
```
hh/
├── hardhat/                         # Hardhat project root
│   ├── contracts/
│   │   └── Ballot.sol               # Ballot smart contract
│   ├── scripts/                     # Stage execution scripts
│   │   ├── run_stage1_direct_call.js
│   │   ├── run_stage2_deploy_wrapper.js  # Deploys Ballot.sol
│   │   └── run_stage3_invoke_wrapper.js  # Interacts with Ballot.sol
│   │   └── lib/
│   │       └── result_logger.js     # Helper for logging results
│   ├── hardhat.config.js            # Hardhat configuration
│   ├── package.json                 # Hardhat project dependencies and scripts
│   └── results/                     # Directory for results.json (mounted from Docker)
├── Dockerfile                       # Dockerfile for building the Hardhat runner image
├── run_all_stages_with_kurtosis.sh  # Main orchestration script
└── README.md                        # This file
```
---
## Prerequisites

Before you begin, ensure you have the following installed on your **Linux** system:

* **Docker Engine:** To build and run Docker containers. Installation guide: [Install Docker Engine on Ubuntu](https://docs.docker.com/engine/install/ubuntu/) (or select your specific Linux distribution).
* **Kurtosis CLI:** The Kurtosis command-line interface. Installation guide: [Kurtosis Install](https://docs.kurtosis.com/install).
* **Bash:** For running shell scripts. Typically pre-installed on most Linux distributions.
* **Standard Linux utilities:** `awk`, `echo`, `mkdir`, `docker`, `kurtosis`, `chmod`.

---
## Setup

1.  **Clone/Create Project:**
    Obtain the project files and navigate into the `hh` directory.
    ```bash
    # Example: git clone <your-repo-url>
    # cd hh
    ```

2.  **Kurtosis Engine:**
    Make sure your Kurtosis engine is running. If not, start it:
    ```bash
    kurtosis engine start
    ```

3.  **Orchestrator Script Configuration:**
    The `run_all_stages_with_kurtosis.sh` script is configured to use the following default values which can be overridden by setting environment variables in your shell before running the script:
    * **Private Key (`HH_PRIVATE_KEY`):** Defaults to `12d7de8621a77640c9241b2595ba78ce443d05e94090365ab3bb5e19df82c625` (note: `0x` prefix is handled by the script/Hardhat config).
    * **Chain ID (`HH_CHAIN_ID`):** Defaults to `10101`.

    The script will dynamically determine the project `ETH_RPC_URL` 

    If your Kurtosis Starlark package uses different service, port, or enclave naming conventions, you **must** either:
    * Or, export these variables with your custom values in your shell before running the script. For example:
        ```bash
        export HH_PRIVATE_KEY="your_other_private_key_without_0x"
        export HH_CHAIN_ID="your_other_chain_id"
        ```

4.  **Make Orchestrator Script Executable:**
    ```bash
    chmod +x ./run_all_stages_with_kurtosis.sh
    ```

---
## Running The Entire Process

The `run_all_stages_with_kurtosis.sh` script automates the entire workflow:

1.  Starts a Kurtosis enclave with an Erigon node (using the configured enclave, service, and port names).
2.  Dynamically determines the Erigon RPC URL.
3.  Builds the Docker image for the Hardhat project (if not already built).
4.  Runs the Hardhat Docker container, which sequentially executes all three task stages:
    * Stage 1: Direct call to the `sha256` precompile.
    * Stage 2: Deployment of the `Ballot.sol` contract.
    * Stage 3: Interaction with the deployed `Ballot.sol` contract.
5.  (Optionally) Cleans up the Kurtosis enclave after execution. By default, cleanup is commented out in the script to allow for inspection.

**To execute:**
From root  run:
```bash
 ./run_all_stages_with_kurtosis.sh```
**To check results**
```
bash
cat $PWD/hardhat/results/result.json | jq```
