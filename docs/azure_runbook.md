# Azure Offline Embedding Runbook

## Parameters

```bash
RESOURCE_GROUP="rg-reverse-wiktionary"
LOCATION="eastus"
CONTAINER="reverse-wiktionary"
STORAGE_ACCOUNT="<storage-account-name>"
```

```bash
VM_NAME="vm-reverse-wiktionary-embed"
VM_SIZE="Standard_NC4as_T4_v3"
ADMIN_USER="azureuser"
OS_IMAGE="Ubuntu2204"
OS_DISK_SIZE_GB="512"
OS_DISK_SKU="StandardSSD_LRS"
```

```bash
PRODUCT_COLLECTION="reverse_wiktionary_v1"
TEST_COLLECTION="reverse_wiktionary_test"
PRODUCT_MODEL="sentence-transformers/all-mpnet-base-v2"
TEST_MODEL="sentence-transformers/all-MiniLM-L6-v2"
```

## Subscription

```bash
az login
az account list --output table
az account set --subscription "Azure subscription 1"
```

## Provider Registration

```bash
az provider register --namespace Microsoft.Storage
```

```bash
az provider register --namespace Microsoft.Compute
az provider register --namespace Microsoft.Quota
```

```bash
az provider show --namespace Microsoft.Compute --query "registrationState" --output tsv
az provider show --namespace Microsoft.Quota --query "registrationState" --output tsv
```

```bash
az provider show --namespace Microsoft.Storage --query "registrationState" --output tsv
```

## Blob Storage

```bash
az group create \
  --name "$RESOURCE_GROUP" \
  --location "$LOCATION"
```

```bash
az storage account create \
  --name "$STORAGE_ACCOUNT" \
  --resource-group "$RESOURCE_GROUP" \
  --location "$LOCATION" \
  --sku Standard_LRS \
  --kind StorageV2
```

```bash
az storage container create \
  --account-name "$STORAGE_ACCOUNT" \
  --name "$CONTAINER" \
  --auth-mode login
```

```bash
az storage container list \
  --account-name "$STORAGE_ACCOUNT" \
  --auth-mode login \
  --output table
```

## Blob Layout

```bash
raw/<run_id>/
raw/latest.json

processed/<run_id>/
processed/latest.json

embeddings/<run_id>/

code/<run_id>/

indexes/<run_id>/
indexes/latest.json

logs/<cloud_run_id>/
logs/<cloud_run_id>/remote_embedding_job.log
logs/<cloud_run_id>/status.json
```

## Local Artifact Upload

```bash
./scripts/download_wiktionary_dump.sh --use-existing
```

```bash
./scripts/run_parse_wiktionary.sh
```

```bash
./scripts/upload_raw_to_blob.sh \
  --storage-account "$STORAGE_ACCOUNT" \
  --container "$CONTAINER"
```

```bash
./scripts/upload_processed_to_blob.sh \
  --storage-account "$STORAGE_ACCOUNT" \
  --container "$CONTAINER"
```

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

```bash
./scripts/download_processed_from_blob.sh \
  --storage-account "$STORAGE_ACCOUNT" \
  --container "$CONTAINER" \
  --dest-root /tmp/revwik-processed \
  --latest
```

## Local Embedding Smoke Test

```bash
./scripts/test_embedding_pipeline.sh
```

```bash
./scripts/test_embedding_quality.sh
```

## Pricing Check

```bash
curl -sG "https://prices.azure.com/api/retail/prices" \
  --data-urlencode "\$filter=serviceName eq 'Virtual Machines' and armRegionName eq '$LOCATION' and armSkuName eq '$VM_SIZE' and priceType eq 'Consumption'" \
  | jq '.Items[] | {armSkuName, productName, skuName, retailPrice, unitOfMeasure}'
```

## VM Quota

```bash
az vm list-skus \
  --location "$LOCATION" \
  --size "$VM_SIZE" \
  --output table
```

```bash
az vm list-usage \
  --location "$LOCATION" \
  --query "[?name.localizedValue=='Standard NCASv3_T4 Family vCPUs'].{Name:name.localizedValue, Current:currentValue, Limit:limit}" \
  --output table
```

```bash
QUOTA_SCOPE="/subscriptions/$(az account show --query id --output tsv)/providers/Microsoft.Compute/locations/$LOCATION"
RESOURCE_NAME="Standard NCASv3_T4 Family"
```

```bash
az quota create \
  --resource-name "$RESOURCE_NAME" \
  --scope "$QUOTA_SCOPE" \
  --resource-type dedicated \
  --limit-object value=4
```

## VM

```bash
az vm create \
  --resource-group "$RESOURCE_GROUP" \
  --name "$VM_NAME" \
  --location "$LOCATION" \
  --image "$OS_IMAGE" \
  --size "$VM_SIZE" \
  --admin-username "$ADMIN_USER" \
  --generate-ssh-keys \
  --assign-identity \
  --os-disk-size-gb "$OS_DISK_SIZE_GB" \
  --storage-sku "$OS_DISK_SKU"
```

```bash
az vm extension set \
  --resource-group "$RESOURCE_GROUP" \
  --vm-name "$VM_NAME" \
  --name NvidiaGpuDriverLinux \
  --publisher Microsoft.HpcCompute \
  --version 1.6
```

```bash
PRINCIPAL_ID="$(az vm identity show \
  --resource-group "$RESOURCE_GROUP" \
  --name "$VM_NAME" \
  --query principalId \
  --output tsv)"
```

```bash
STORAGE_ID="$(az storage account show \
  --name "$STORAGE_ACCOUNT" \
  --resource-group "$RESOURCE_GROUP" \
  --query id \
  --output tsv)"
```

```bash
az role assignment create \
  --assignee "$PRINCIPAL_ID" \
  --role "Storage Blob Data Contributor" \
  --scope "$STORAGE_ID"
```

## VM Bootstrap

```bash
az vm run-command invoke \
  --resource-group "$RESOURCE_GROUP" \
  --name "$VM_NAME" \
  --command-id RunShellScript \
  --scripts @scripts/azure/bootstrap_embedding_vm.sh
```

```bash
az vm run-command invoke \
  --resource-group "$RESOURCE_GROUP" \
  --name "$VM_NAME" \
  --command-id RunShellScript \
  --scripts "python --version && python -m pip --version && az version && docker --version && docker compose version"
```

```bash
az vm run-command invoke \
  --resource-group "$RESOURCE_GROUP" \
  --name "$VM_NAME" \
  --command-id RunShellScript \
  --scripts "az login --identity --output none && az storage container list --account-name $STORAGE_ACCOUNT --auth-mode login --output table"
```

## Offline Embedding Runs

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

## Cloud Run Records

```bash
az storage blob download \
  --account-name "$STORAGE_ACCOUNT" \
  --container-name "$CONTAINER" \
  --name "logs/<cloud_run_id>/status.json" \
  --file "/tmp/revwik-status.json" \
  --auth-mode login \
  --overwrite
```

```bash
az storage blob download \
  --account-name "$STORAGE_ACCOUNT" \
  --container-name "$CONTAINER" \
  --name "logs/<cloud_run_id>/remote_embedding_job.log" \
  --file "/tmp/revwik-remote.log" \
  --auth-mode login \
  --overwrite
```

```bash
jq . /tmp/revwik-status.json
```

```bash
cp runs/offline_embedding/TEMPLATE.md "runs/offline_embedding/<cloud_run_id>.md"
```

## Snapshot Upload

```bash
./scripts/store_qdrant_snapshot.sh \
  --collection-name "$PRODUCT_COLLECTION" \
  --upload \
  --storage-account "$STORAGE_ACCOUNT" \
  --container "$CONTAINER"
```

## Shutdown

```bash
az vm deallocate \
  --resource-group "$RESOURCE_GROUP" \
  --name "$VM_NAME"
```

```bash
az vm get-instance-view \
  --resource-group "$RESOURCE_GROUP" \
  --name "$VM_NAME" \
  --query "instanceView.statuses[?starts_with(code, 'PowerState/')].displayStatus" \
  --output tsv
```

```bash
az resource list \
  --resource-group "$RESOURCE_GROUP" \
  --output table
```
