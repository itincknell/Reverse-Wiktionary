# Azure Runbook

This runbook records the Azure setup choices and command sequence for the
offline embedding pipeline. It is intentionally command-first so it can be
extended into the final deployment runbook later.

See [data_contracts.md](data_contracts.md) for local and Blob artifact schemas.

## Configuration

```bash
RESOURCE_GROUP="rg-reverse-wiktionary"
LOCATION="eastus"
CONTAINER="reverse-wiktionary"
STORAGE_ACCOUNT="<your-storage-account-name>"
```

```bash
VM_NAME="vm-reverse-wiktionary-embed"
VM_SIZE="Standard_NC4as_T4_v3"
ADMIN_USER="azureuser"
```

```bash
PRODUCT_COLLECTION="reverse_wiktionary_v1"
TEST_COLLECTION="reverse_wiktionary_test"

PRODUCT_MODEL="sentence-transformers/all-mpnet-base-v2"
TEST_MODEL="sentence-transformers/all-MiniLM-L6-v2"
```

## Azure CLI Login

```bash
az login
```

```bash
az account list --output table
```

```bash
az account set --subscription "Azure subscription 1"
```

## Resource Provider Setup

Register the Storage provider if storage commands fail with subscription or
provider errors.

```bash
az provider register --namespace Microsoft.Storage
```

```bash
az provider show \
  --namespace Microsoft.Storage \
  --query "registrationState" \
  --output tsv
```

Wait until the output is:

```bash
Registered
```

## Blob Storage Setup

Create the resource group.

```bash
az group create \
  --name "$RESOURCE_GROUP" \
  --location "$LOCATION"
```

Create the storage account.

```bash
az storage account create \
  --name "$STORAGE_ACCOUNT" \
  --resource-group "$RESOURCE_GROUP" \
  --location "$LOCATION" \
  --sku Standard_LRS \
  --kind StorageV2
```

Create the Blob container. A Blob container is bucket-like storage, not a Docker
container.

```bash
az storage container create \
  --account-name "$STORAGE_ACCOUNT" \
  --name "$CONTAINER" \
  --auth-mode login
```

Verify the container exists.

```bash
az storage container list \
  --account-name "$STORAGE_ACCOUNT" \
  --auth-mode login \
  --output table
```

Optional smoke test.

```bash
az storage blob upload \
  --account-name "$STORAGE_ACCOUNT" \
  --container-name "$CONTAINER" \
  --name "smoke-test/hello.txt" \
  --file LICENSE \
  --auth-mode login
```

```bash
az storage blob list \
  --account-name "$STORAGE_ACCOUNT" \
  --container-name "$CONTAINER" \
  --prefix "smoke-test/" \
  --auth-mode login \
  --output table
```

```bash
az storage blob delete \
  --account-name "$STORAGE_ACCOUNT" \
  --container-name "$CONTAINER" \
  --name "smoke-test/hello.txt" \
  --auth-mode login
```

## Blob Artifact Layout

The project uses immutable run prefixes and small `latest.json` pointer blobs.

```bash
raw/<run_id>/
raw/latest.json

processed/<run_id>/
processed/latest.json

embeddings/<run_id>/

code/<run_id>/

indexes/<run_id>/
indexes/latest.json
```

## Local Raw And Processed Artifacts

Download or reuse the Kaikki/Wiktextract raw dump locally.

```bash
./scripts/download_wiktionary_dump.sh --use-existing
```

Or force a fresh raw download.

```bash
./scripts/download_wiktionary_dump.sh --download-new
```

Normalize raw Wiktionary JSONL into processed shards.

```bash
./scripts/run_parse_wiktionary.sh
```

Upload raw artifacts to Blob and update `raw/latest.json`.

```bash
./scripts/upload_raw_to_blob.sh \
  --storage-account "$STORAGE_ACCOUNT" \
  --container "$CONTAINER"
```

Upload processed artifacts to Blob and update `processed/latest.json`.

```bash
./scripts/upload_processed_to_blob.sh \
  --storage-account "$STORAGE_ACCOUNT" \
  --container "$CONTAINER"
```

Verify `processed/latest.json`.

```bash
az storage blob download \
  --account-name "$STORAGE_ACCOUNT" \
  --container-name "$CONTAINER" \
  --name "processed/latest.json" \
  --file /tmp/processed-latest.json \
  --auth-mode login \
  --overwrite
```

```bash
jq . /tmp/processed-latest.json
```

Test downloading processed artifacts to a temporary local directory.

```bash
./scripts/download_processed_from_blob.sh \
  --storage-account "$STORAGE_ACCOUNT" \
  --container "$CONTAINER" \
  --dest-root /tmp/revwik-processed \
  --latest
```

## Local Offline Embedding Smoke Test

Start local Qdrant.

```bash
./scripts/start_qdrant.sh
```

Run the small local embedding smoke test. This intentionally uses
`reverse_wiktionary_test`.

```bash
./scripts/test_generate_embeddings.sh
```

Run quality checks against the test collection.

```bash
./scripts/test_embedding_quality.sh
```

Stop local Qdrant.

```bash
./scripts/stop_qdrant.sh
```

Or run the local pipeline wrapper, which starts and stops Qdrant for the smoke
test.

```bash
./scripts/test_embedding_pipeline.sh
```

## Cost Check

Query the current retail price for the selected GPU VM.

```bash
curl -sG "https://prices.azure.com/api/retail/prices" \
  --data-urlencode "\$filter=serviceName eq 'Virtual Machines' and armRegionName eq '$LOCATION' and armSkuName eq '$VM_SIZE' and priceType eq 'Consumption'" \
  | jq '.Items[] | {armSkuName, productName, skuName, retailPrice, unitOfMeasure}'
```

Rough planning estimate for `Standard_NC4as_T4_v3` in East US was about
`$0.50-$0.60/hour` on demand when this runbook was started. Always check current
pricing before a long run.

## VM Availability Check

Confirm the GPU VM SKU is available in the chosen region.

```bash
az vm list-skus \
  --location "$LOCATION" \
  --size "$VM_SIZE" \
  --output table
```

Expected result from this setup:

```bash
ResourceType     Locations    Name                  Zones    Restrictions
---------------  -----------  --------------------  -------  --------------
virtualMachines  eastus       Standard_NC4as_T4_v3  1,2,3    None
```

## Create GPU VM

Create the VM with a managed identity and a 512 GiB OS disk.

```bash
az vm create \
  --resource-group "$RESOURCE_GROUP" \
  --name "$VM_NAME" \
  --location "$LOCATION" \
  --image Ubuntu2204 \
  --size "$VM_SIZE" \
  --admin-username "$ADMIN_USER" \
  --generate-ssh-keys \
  --assign-identity \
  --os-disk-size-gb 512 \
  --storage-sku StandardSSD_LRS
```

Install the NVIDIA Linux GPU driver extension.

```bash
az vm extension set \
  --resource-group "$RESOURCE_GROUP" \
  --vm-name "$VM_NAME" \
  --name NvidiaGpuDriverLinux \
  --publisher Microsoft.HpcCompute \
  --version 1.6
```

## Grant VM Blob Access

Get the VM managed identity principal ID.

```bash
PRINCIPAL_ID="$(az vm identity show \
  --resource-group "$RESOURCE_GROUP" \
  --name "$VM_NAME" \
  --query principalId \
  --output tsv)"
```

Get the storage account resource ID.

```bash
STORAGE_ID="$(az storage account show \
  --name "$STORAGE_ACCOUNT" \
  --resource-group "$RESOURCE_GROUP" \
  --query id \
  --output tsv)"
```

Assign the VM identity permission to read and write Blob artifacts.

```bash
az role assignment create \
  --assignee "$PRINCIPAL_ID" \
  --role "Storage Blob Data Contributor" \
  --scope "$STORAGE_ID"
```

## Run Offline Embedding On VM

Normal product run, expecting `processed/latest.json` to exist in Blob.

```bash
./scripts/run_embeddings_on_azure_vm.sh \
  --resource-group "$RESOURCE_GROUP" \
  --vm-name "$VM_NAME" \
  --storage-account "$STORAGE_ACCOUNT" \
  --container "$CONTAINER" \
  --collection-name "$PRODUCT_COLLECTION" \
  --model-name "$PRODUCT_MODEL" \
  --leave-running
```

Product run that prepares processed input from raw Blob data if processed
artifacts are missing.

```bash
./scripts/run_embeddings_on_azure_vm.sh \
  --resource-group "$RESOURCE_GROUP" \
  --vm-name "$VM_NAME" \
  --storage-account "$STORAGE_ACCOUNT" \
  --container "$CONTAINER" \
  --collection-name "$PRODUCT_COLLECTION" \
  --model-name "$PRODUCT_MODEL" \
  --prepare-processed-if-missing \
  --leave-running
```

Full fallback run: if processed is missing, try raw from Blob; if raw is also
missing, download from Kaikki, upload raw, normalize, upload processed, embed,
snapshot Qdrant, and upload the snapshot.

```bash
./scripts/run_embeddings_on_azure_vm.sh \
  --resource-group "$RESOURCE_GROUP" \
  --vm-name "$VM_NAME" \
  --storage-account "$STORAGE_ACCOUNT" \
  --container "$CONTAINER" \
  --collection-name "$PRODUCT_COLLECTION" \
  --model-name "$PRODUCT_MODEL" \
  --prepare-processed-if-missing \
  --allow-raw-download \
  --leave-running
```

Remove `--leave-running` after the workflow is stable. Without that flag, the
launcher deallocates the VM when the Azure Run Command exits.

## Snapshot Upload

The VM job calls this after embedding generation.

```bash
./scripts/store_qdrant_snapshot.sh \
  --collection-name "$PRODUCT_COLLECTION" \
  --upload \
  --storage-account "$STORAGE_ACCOUNT" \
  --container "$CONTAINER"
```

The snapshot script uploads:

```bash
indexes/<run_id>/
indexes/latest.json
```

## Shutdown And Cost Control

Deallocate the VM when it is not running work.

```bash
az vm deallocate \
  --resource-group "$RESOURCE_GROUP" \
  --name "$VM_NAME"
```

Check VM power state.

```bash
az vm get-instance-view \
  --resource-group "$RESOURCE_GROUP" \
  --name "$VM_NAME" \
  --query "instanceView.statuses[?starts_with(code, 'PowerState/')].displayStatus" \
  --output tsv
```

List high-level resources in the project group.

```bash
az resource list \
  --resource-group "$RESOURCE_GROUP" \
  --output table
```

## Notes To Add Later

```bash
# TODO: Add remote log upload paths after VM logging is implemented.
# TODO: Add one-time VM bootstrap commands for Docker, jq, Azure CLI, and Python deps.
# TODO: Add restore-from-Qdrant-snapshot command sequence.
# TODO: Add final deployment commands for serving the reverse dictionary API.
```
