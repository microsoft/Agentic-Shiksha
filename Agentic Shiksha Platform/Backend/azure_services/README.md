# azure_services

Azure integration layer for the Ekalaiva backend (agents, search, storage,
persistence, evaluation). Shared configuration lives in [config.py](config.py).
Use the [service setup](../README.md) for credentials and environment precedence;
importing configuration is not an offline readiness probe.

| Area | Implementation |
| --- | --- |
| [agents/](agents/README.md) | Named Foundry agents, versions and lifecycle helpers. |
| [persistence/](persistence/README.md) | Cosmos state, curriculum archives, quotas and scoped repository contracts. |
| [storage/](storage/README.md) | Blob operations using Entra credentials. |
| [tools/search/](tools/search/README.md) | Course index lifecycle and search paths. |
| [tools/memory/](tools/memory/README.md) | Foundry memory-store lifecycle and queries. |
| [tools/retrieval/](tools/retrieval/README.md) | Placeholder namespace, not a standalone retrieval implementation. |
| [evaluation/](evaluation/README.md) | Placeholder namespace; dashboard scoring is a separate service concern. |
| [content_guardrail.py](content_guardrail.py) | Optional runtime Content Safety check, distinct from evaluation metrics. |

## Memory Store Manager

[tools/memory/memory_store_manager.py](tools/memory/memory_store_manager.py)
provides per-agent memory with a caller-supplied user scope.
Each agent gets its own memory store; within a store, memories are partitioned
by `scope`. Callers must derive that scope from the authenticated learner and
preserve the course boundary; a string parameter alone is not authorization.

### Architecture

```
Agent A  -->  MemoryStore "agent-A-memory"
                 |-- scope: user_1  (Student 1's memories)
                 |-- scope: user_2  (Student 2's memories)
                 +-- scope: user_3  (Student 3's memories)

Agent B  -->  MemoryStore "agent-B-memory"
                 |-- scope: user_1
                 +-- scope: user_4
```

### Usage

This is a **live-service example**, not a local smoke test: it creates a memory
store and deletes the example scope's memories. Use only deliberately selected
development resources. The offline suite uses mocks instead.

```python
from azure_services.config import PROJECT_ENDPOINT
from azure_services.tools.memory.memory_store_manager import MemoryStoreManager

mgr = MemoryStoreManager(project_endpoint=PROJECT_ENDPOINT)

# Create a dedicated memory store for an agent
store = mgr.create_memory_store_for_agent("my-agent-name")

# Get MemorySearchTool with dynamic user scope (attach to agent)
tool = mgr.get_memory_search_tool("my-agent-name-memory")

# Search memories for a specific user
results = mgr.search_memories("my-agent-name-memory", scope="user_123", query="What are my preferences?")

# Delete a specific user's memories
mgr.delete_user_memories("my-agent-name-memory", scope="user_123")
```

Reference: https://learn.microsoft.com/en-us/azure/ai-foundry/agents/how-to/memory-usage

## Azure resource creation commands

This is the canonical **PowerShell 7** reference for creating the resources in the
supplied infrastructure inventory. Each resource recipe appears once; reuse it
with different names/regions only when another resource is deliberately required.
For images and web apps, continue with the shared
[ACR and App Service commands](../../../docs/deployment.md#azure-cli-container-and-app-service-commands).
Service READMEs link here rather than repeating provisioning commands.

**These are optional, billable operator actions, not application startup steps.**
Reuse existing approved resources. Resource creation alone does not deploy models,
create named agents or project connections, configure application sign-in, grant
data-plane permissions, or initialize application data. Do not rerun these as an
upgrade or migration procedure. No commands in this guide have been executed as
part of the documentation update.

### Common context

Use an Azure CLI version that supports the listed commands. Replace every
`<PLACEHOLDER>` with an approved value; resource names must meet Azure's naming and
global-uniqueness requirements. The resource group must already exist. Choose
regions/SKUs for availability, quota, latency, residency and cost, not by copying
another deployment's settings.

```powershell
$subscriptionId = '<SUBSCRIPTION_ID>'
$resourceGroup = '<RESOURCE_GROUP_NAME>'
az login
az account set --subscription $subscriptionId
if ($LASTEXITCODE -ne 0) { throw 'Could not select the approved subscription.' }
az account show --query '{name:name,id:id}' --output table
```

All subsequent blocks use this context. PowerShell continuations use a backtick
with **no trailing spaces**, not Bash's `\`. Stop on a failed command and resolve
the error before running dependent steps.

### Foundry account and project

The image-generation account and the separate Foundry account/project pairs in
the inventory use the same account recipe. Do not create three copies by default.
Repeat this block only for explicitly separate projects/resources, with their own
region and names. Provisioning an image-capable account does not deploy an image model.

```powershell
$foundryName = '<FOUNDRY_RESOURCE_NAME>'
$projectName = '<FOUNDRY_PROJECT_NAME>'
$foundryLocation = '<FOUNDRY_REGION>'

az cognitiveservices account create `
  --resource-group $resourceGroup --name $foundryName `
  --location $foundryLocation --kind AIServices --sku S0 `
  --custom-domain $foundryName --assign-identity `
  --allow-project-management true --yes
if ($LASTEXITCODE -ne 0) { throw 'Foundry account creation failed.' }

az cognitiveservices account project create `
  --resource-group $resourceGroup --name $foundryName `
  --project-name $projectName --location $foundryLocation
```

Configure the resulting project endpoint, approved model deployments and connection
IDs through the [backend environment contract](../.env.example). Account/project
identity assignment does not grant that identity access to Search, Storage or Cosmos.
See the [project CLI reference](https://learn.microsoft.com/cli/azure/cognitiveservices/account/project).

### Log Analytics and Application Insights

Create one workspace/component pair per approved monitoring design. Reuse the
returned workspace **resource ID**, rather than assuming the component command
can resolve a workspace name.

```powershell
$monitorLocation = '<MONITORING_REGION>'
$workspaceName = '<LOG_ANALYTICS_WORKSPACE_NAME>'
$insightsName = '<APPLICATION_INSIGHTS_NAME>'

az monitor log-analytics workspace create `
  --resource-group $resourceGroup --workspace-name $workspaceName `
  --location $monitorLocation
if ($LASTEXITCODE -ne 0) { throw 'Workspace creation failed.' }
$workspaceId = az monitor log-analytics workspace show `
  --resource-group $resourceGroup --workspace-name $workspaceName `
  --query id --output tsv
if ($LASTEXITCODE -ne 0 -or -not $workspaceId) { throw 'Workspace lookup failed.' }

az monitor app-insights component create `
  --resource-group $resourceGroup --app $insightsName `
  --location $monitorLocation --workspace $workspaceId --output none
```

Use the official `application-insights` CLI extension if that command group is
not installed. Creating these resources does not instrument the app automatically;
configure telemetry and retention separately without logging learner content.

### Grounding with Bing Search or Bing Custom Search

These are two different optional resources, not interchangeable project connection
IDs. Select one row, run the single creation command, and repeat only if both tools
are needed. The account location is `global`.

| Variant | `kind` | SKU | API version from the supplied recipe |
| --- | --- | --- | --- |
| `search` | `Bing.Grounding` | `G1` | `2025-05-01-preview` |
| `custom` | `Bing.GroundingCustomSearch` | `G2` | `2020-06-10` |

```powershell
$bingVariant = 'search' # Or 'custom'; choose deliberately.
$bingName = '<BING_RESOURCE_NAME>'
$bingRecipes = @{
  search = @{ kind = 'Bing.Grounding'; sku = 'G1'; api = '2025-05-01-preview' }
  custom = @{ kind = 'Bing.GroundingCustomSearch'; sku = 'G2'; api = '2020-06-10' }
}
$bing = $bingRecipes[$bingVariant]
if (-not $bing) { throw 'Choose search or custom.' }
$bodyFile = [System.IO.Path]::GetTempFileName()
try {
  @{
    location = 'global'
    kind = $bing.kind
    sku = @{ name = $bing.sku }
    properties = @{}
  } | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath $bodyFile -Encoding utf8

  az resource create --resource-group $resourceGroup --name $bingName `
    --resource-type Microsoft.Bing/accounts --api-version $bing.api `
    --is-full-object --properties "@$bodyFile"
  if ($LASTEXITCODE -ne 0) { throw 'Bing resource creation failed.' }
} finally {
  Remove-Item -LiteralPath $bodyFile
}
```

Check current provider support, pricing and terms before applying either recipe,
especially the preview API. Create the appropriate Foundry project connection
afterward; Custom Search also needs a configured instance/domain allowlist.
Creating/using Bing grounding accepts its terms and involves data-processing
boundaries different from the agent service. See Microsoft's
[Bing grounding guidance](https://learn.microsoft.com/azure/ai-foundry/agents/how-to/tools/bing-grounding)
and [Custom Search guidance](https://learn.microsoft.com/azure/ai-foundry/agents/how-to/tools/bing-custom-search).

### Search, Document Intelligence and Speech

These serve different purposes and require separate resource names. `basic` and
`S0` below reproduce the supplied service tiers, not a production sizing recommendation.

```powershell
az search service create `
  --resource-group $resourceGroup --name '<SEARCH_SERVICE_NAME>' `
  --location '<SEARCH_REGION>' --sku basic

az cognitiveservices account create `
  --resource-group $resourceGroup --name '<DOCUMENT_INTELLIGENCE_RESOURCE_NAME>' `
  --location '<DOCUMENT_INTELLIGENCE_REGION>' --kind FormRecognizer --sku S0 --yes

$speechName = '<SPEECH_RESOURCE_NAME>'
az cognitiveservices account create `
  --resource-group $resourceGroup --name $speechName `
  --location '<SPEECH_REGION>' --kind SpeechServices --sku S0 `
  --custom-domain $speechName --yes
```

Search indexes, indexers, data sources, skillsets, embeddings and project connections
remain separate setup. The Speech custom subdomain is needed by the backend's
Entra-authenticated narration path; microphone input also needs the matching
`AZURE_SPEECH_REGION`. Assign **Cognitive Services Speech User** on that resource
to the calling identity, and configure the other services' data-plane roles
separately. Do not copy account keys into examples.

### Cosmos DB: NoSQL required; MongoDB optional

The current application persistence uses **Cosmos DB for NoSQL**, not the MongoDB
API. The MongoDB account in the inventory is an optional/separate workload; do not
point `COSMOS_ENDPOINT` at it or create it just to run this app.

```powershell
# Current app: a serverless NoSQL account, if this capacity model is approved.
$cosmosName = '<NOSQL_ACCOUNT_NAME>'
$cosmosLocation = '<COSMOS_REGION>'
az cosmosdb create `
  --resource-group $resourceGroup --name $cosmosName --kind GlobalDocumentDB `
  --locations "regionName=$cosmosLocation" failoverPriority=0 isZoneRedundant=false `
  --default-consistency-level Session --capabilities EnableServerless
```

Run this separate alternative **only for an approved MongoDB workload**:

```powershell
$mongoLocation = '<MONGODB_REGION>'
az cosmosdb create `
  --resource-group $resourceGroup --name '<MONGODB_ACCOUNT_NAME>' --kind MongoDB `
  --locations "regionName=$mongoLocation" failoverPriority=0 isZoneRedundant=false
```

These account commands do not create the application's database/container schema
or migrate data. Set `COSMOS_DATABASE` deliberately and preserve documented partition
keys. Serverless capacity, one region and disabled zone redundancy are choices in
this example, not a blanket availability recommendation. Graph-memory stores have
their own explicit [provisioning procedure](../learner_memory/README.md#provisioning-and-migration).

### Blob Storage and an optional user-assigned identity

```powershell
az storage account create `
  --resource-group $resourceGroup --name '<STORAGE_ACCOUNT_NAME>' `
  --location '<STORAGE_REGION>' --sku Standard_RAGRS --kind StorageV2 `
  --access-tier Hot --https-only true --min-tls-version TLS1_2 `
  --allow-blob-public-access false

az identity create `
  --resource-group $resourceGroup --name '<MANAGED_IDENTITY_NAME>' `
  --location '<IDENTITY_REGION>'
```

Select replication for the intended region, cost and recovery requirements.
Create private containers and grant scoped Blob data access separately.
The user-assigned identity is not automatically attached to an app or given
permissions. The deployment recipe below uses system-assigned image-pull identity
for **new** web apps; preserve any existing user-assigned image-pull configuration.

### Optional VNet, subnets, NSGs and MongoDB Private DNS

Run only when private networking is part of the approved design. The example
address ranges must not overlap connected networks. This does **not** integrate
App Service with the VNet, create a Cosmos private endpoint, or disable public
access by itself.

```powershell
$networkLocation = '<NETWORK_REGION>'
$vnetName = '<VNET_NAME>'
$appSubnet = '<APP_SUBNET_NAME>'
$endpointSubnet = '<PRIVATE_ENDPOINT_SUBNET_NAME>'

az network vnet create `
  --resource-group $resourceGroup --name $vnetName --location $networkLocation `
  --address-prefixes 10.0.0.0/16 --subnet-name $appSubnet --subnet-prefixes 10.0.1.0/24
if ($LASTEXITCODE -ne 0) { throw 'VNet creation failed.' }
az network vnet subnet create `
  --resource-group $resourceGroup --vnet-name $vnetName `
  --name $endpointSubnet --address-prefixes 10.0.2.0/24
if ($LASTEXITCODE -ne 0) { throw 'Private-endpoint subnet creation failed.' }

$subnetNsgs = @(
  @{ subnet = $appSubnet; nsg = '<APP_NSG_NAME>' }
  @{ subnet = $endpointSubnet; nsg = '<PRIVATE_ENDPOINT_NSG_NAME>' }
)
foreach ($entry in $subnetNsgs) {
  az network nsg create --resource-group $resourceGroup `
    --name $entry.nsg --location $networkLocation
  if ($LASTEXITCODE -ne 0) { throw 'NSG creation failed.' }
  az network vnet subnet update --resource-group $resourceGroup `
    --vnet-name $vnetName --name $entry.subnet --network-security-group $entry.nsg
  if ($LASTEXITCODE -ne 0) { throw 'Subnet NSG association failed.' }
}

# MongoDB only. Cosmos NoSQL uses privatelink.documents.azure.com instead.
$dnsZone = 'privatelink.mongo.cosmos.azure.com'
az network private-dns zone create --resource-group $resourceGroup --name $dnsZone
if ($LASTEXITCODE -ne 0) { throw 'Private DNS zone creation failed.' }
$vnetId = az network vnet show --resource-group $resourceGroup `
  --name $vnetName --query id --output tsv
if ($LASTEXITCODE -ne 0 -or -not $vnetId) { throw 'VNet lookup failed.' }
az network private-dns link vnet create `
  --resource-group $resourceGroup --zone-name $dnsZone `
  --name '<PRIVATE_DNS_LINK_NAME>' --virtual-network $vnetId --registration-enabled false
```

The pasted DNS-link command was incomplete; `--registration-enabled false` is
explicit here. Add the private endpoint and its **DNS zone group** through the
network deployment, so records follow endpoint recreation. Do not hardcode old
private IPs or manually freeze A records. Default NSG rules are not an application
firewall policy; review subnet delegation, routes, DNS and endpoint policies for
the actual design. See the [Private DNS link reference](https://learn.microsoft.com/cli/azure/network/private-dns/link/vnet).

### Container Registry and Linux App Service Plan

```powershell
az acr create `
  --resource-group $resourceGroup --name '<ACR_NAME>' `
  --location '<REGISTRY_REGION>' --sku Standard --admin-enabled false

az appservice plan create `
  --resource-group $resourceGroup --name '<APP_SERVICE_PLAN_NAME>' `
  --location '<APP_SERVICE_REGION>' --sku B1 --is-linux
```

Registry names are globally unique. `B1` is the supplied baseline, not evidence
of sufficient capacity or support for staging slots. A shared plan means the four
apps share capacity; provision separate plans when required by isolation/load.
Build images, create the selected web apps, and configure registry access using
the [single shared deployment recipe](../../../docs/deployment.md#azure-cli-container-and-app-service-commands).
