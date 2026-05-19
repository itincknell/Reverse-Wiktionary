# Azure Serving Runbook

This file records serving deployment settings and command shapes. Offline
embedding runs are documented in `github.com/itincknell/Reverse-Wiktionary-Offline`.

## Shared Azure Settings

```bash
SUBSCRIPTION_ID="<azure-subscription-id>"
RESOURCE_GROUP="<resource-group>"
STORAGE_ACCOUNT="<storage-account>"
CONTAINER="<blob-container>"
COLLECTION_NAME="reverse_wiktionary_v2"
ADMIN_USER="azureuser"
```

## Current Low-Cost Beta Target

```bash
LOCATION="northcentralus"
VM_NAME="vm-reverse-wiktionary-web-beta-ncus"
VM_SIZE="Standard_B2as_v2"
OS_DISK_SIZE_GB=64
STORAGE_SKU="StandardSSD_LRS"
DATA_ROOT="/opt/reverse-wiktionary/data"
```

Quota:

```text
North Central US
Standard Basv2 Family vCPUs: 4
Total Regional vCPUs: 14
```

Estimated cost:

```text
Standard_B2as_v2 compute: about $54.90/mo
64 GiB Standard SSD OS disk: about $5/mo
attached data disk: none
estimated total: about $60/mo
```

## VM Creation

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
  --os-disk-size-gb "$OS_DISK_SIZE_GB" \
  --storage-sku "$STORAGE_SKU" \
  --public-ip-sku Standard
```

## Network Exposure

Public web traffic enters through Cloudflare Tunnel. Qdrant, Redis, FastAPI,
and Nginx are not exposed directly to the internet.

```bash
MY_IP="$(curl -fsS https://ifconfig.me)"

NSG_NAME="$(
  az network nsg list \
    --resource-group "$RESOURCE_GROUP" \
    --query "[?contains(name, '$VM_NAME')].name | [0]" \
    --output tsv
)"

az network nsg rule update \
  --resource-group "$RESOURCE_GROUP" \
  --nsg-name "$NSG_NAME" \
  --name default-allow-ssh \
  --source-address-prefixes "$MY_IP/32"

az network nsg rule list \
  --resource-group "$RESOURCE_GROUP" \
  --nsg-name "$NSG_NAME" \
  --query "[].{name:name, access:access, direction:direction, port:destinationPortRange, source:sourceAddressPrefix}" \
  --output table
```

Expected public inbound rule:

```text
SSH from the operator IP only.
No inbound 80/443 rule.
```

## Storage Access

```bash
PRINCIPAL_ID="$(
  az vm show \
    --resource-group "$RESOURCE_GROUP" \
    --name "$VM_NAME" \
    --query identity.principalId \
    --output tsv
)"

STORAGE_ID="$(
  az storage account show \
    --resource-group "$RESOURCE_GROUP" \
    --name "$STORAGE_ACCOUNT" \
    --query id \
    --output tsv
)"

az role assignment create \
  --assignee "$PRINCIPAL_ID" \
  --role "Storage Blob Data Contributor" \
  --scope "$STORAGE_ID"
```

## Bootstrap

```bash
az vm run-command invoke \
  --resource-group "$RESOURCE_GROUP" \
  --name "$VM_NAME" \
  --command-id RunShellScript \
  --scripts @scripts/azure/bootstrap_serving_vm.sh
```

## Clone/Update Serving Repo

The serving repo is public, so the VM can use HTTPS without GitHub credentials.

```bash
az vm run-command invoke \
  --resource-group "$RESOURCE_GROUP" \
  --name "$VM_NAME" \
  --command-id RunShellScript \
  --scripts @scripts/azure/clone_or_update_serving_repo.sh
```

Default VM checkout:

```text
/opt/reverse-wiktionary/app
```

Patch/update flow on the VM:

```bash
cd /opt/reverse-wiktionary/app
git pull --ff-only origin main
./scripts/web/restart.sh
```

## Cloudflare Tunnel

Create a Cloudflare Tunnel in Cloudflare Zero Trust and route the public
hostname to the Docker service URL:

```text
service: http://nginx:80
```

Store the tunnel token only on the VM:

```bash
cd /opt/reverse-wiktionary/app
cp deploy/web/.env.example deploy/web/.env
chmod 600 deploy/web/.env
```

Edit `deploy/web/.env` on the VM:

```text
COMPOSE_PROFILES=cloudflare
CLOUDFLARE_TUNNEL_TOKEN=<cloudflare-tunnel-token>
```

Start the public deployment:

```bash
cd /opt/reverse-wiktionary/app
./scripts/web/deploy_cloudflare.sh
```

`scripts/web/deploy_prod.sh` reads `deploy/web/.env` explicitly when the file is
present. `scripts/web/deploy_cloudflare.sh` refuses to start without a tunnel
token.

Production Docker networking:

```text
Qdrant: Docker-internal only
Redis: Docker-internal only
FastAPI: Docker-internal only
Nginx: bound to 127.0.0.1:8080 on the VM
Cloudflare Tunnel: outbound-only public path
```

## Web Image Archive

The web image contains the query encoder runtime and its PyTorch dependency
tree. Building it directly on the small beta VM is slow, so deployment can load
a prebuilt Docker archive instead of rebuilding locally.

Build and save:

```bash
scripts/web/build_web_image_archive.sh \
  --tag "$(git rev-parse --short=12 HEAD)" \
  --upload \
  --storage-account "$STORAGE_ACCOUNT" \
  --container "$CONTAINER"
```

Load on the VM:

```bash
az storage blob download \
  --account-name "$STORAGE_ACCOUNT" \
  --container-name "$CONTAINER" \
  --name "docker-images/web/<git_sha>/reverse-wiktionary-web-<git_sha>.tar.gz" \
  --file "/opt/reverse-wiktionary/data/restore/reverse-wiktionary-web.tar.gz" \
  --auth-mode login \
  --overwrite

cd /opt/reverse-wiktionary/app
scripts/web/load_web_image_archive.sh \
  --archive /opt/reverse-wiktionary/data/restore/reverse-wiktionary-web.tar.gz
```

Use the loaded image without rebuilding:

```text
WEB_IMAGE=reverse-wiktionary-web:<git_sha>
WEB_SKIP_BUILD=true
```

## Restore Serving Artifacts

```bash
cd /opt/reverse-wiktionary/app

./scripts/web/restore_qdrant_from_blob.sh \
  --storage-account "$STORAGE_ACCOUNT" \
  --container "$CONTAINER" \
  --collection-name "$COLLECTION_NAME"
```

Use `--replace-existing` when intentionally replacing an existing restored
collection.

## Web Smoke

```bash
./scripts/run_web_smoke_on_azure_vm.sh \
  --resource-group "$RESOURCE_GROUP" \
  --vm-name "$VM_NAME" \
  --storage-account "$STORAGE_ACCOUNT" \
  --container "$CONTAINER" \
  --collection-name "$COLLECTION_NAME" \
  --qdrant-hnsw-ef 512
```

## SSH Tunnel Preview

```bash
PUBLIC_IP="$(
  az vm show \
    --resource-group "$RESOURCE_GROUP" \
    --name "$VM_NAME" \
    --show-details \
    --query publicIps \
    --output tsv
)"

ssh -N -L 18000:127.0.0.1:8080 "$ADMIN_USER@$PUBLIC_IP"
```

Preview:

```text
http://127.0.0.1:18000
```

## Shutdown

```bash
az vm deallocate \
  --resource-group "$RESOURCE_GROUP" \
  --name "$VM_NAME"
```

`deallocate` stops compute billing. The OS disk and public IP continue to incur
small storage/network charges until deleted.
