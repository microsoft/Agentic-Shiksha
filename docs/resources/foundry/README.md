# Set up an outstanding Microsoft Foundry resource

[Resource setup scope and prerequisites](../README.md) | [App Service](../app-service/README.md)

Use this guide once for each Foundry resource marked `Mandatory = 1` in your
inventory. It retains the supplied `AIServices` / `S0` / `westus3` baseline.
An auxiliary image-generation account is not automatically the main teaching
project: keep each resource's purpose and endpoint mapping separate.

Run the [shared PowerShell session](../README.md#powershell-session) first.
The commands below create resources only when you deliberately execute them.
They do not recreate the existing Log Analytics workspace or Application
Insights component, and do not enable application instrumentation.

## 1. Select the outstanding account

```powershell
$FoundryName = '<FOUNDRY_RESOURCE_NAME>'
$FoundryProjectName = '<FOUNDRY_PROJECT_NAME>'
$FoundryLocation = 'westus3'

Invoke-Az cognitiveservices account list --resource-group $ResourceGroup `
    --query '[].{name:name,kind:kind,location:location,sku:sku.name}' --output table
```

Confirm that the name is the outstanding row, not a completed resource.
If the account already exists, skip account creation and inspect it in step 3.
Do not rerun `create` as a way of changing an existing account's settings.
Account/custom-subdomain names must satisfy Azure naming and uniqueness rules.

## 2. Create the missing account only

This extends the supplied command with a custom subdomain and system-assigned
identity. These support Entra authentication and Foundry project management;
creating the application resource without a project is not enough for Agents.

```powershell
$Accounts = @(Invoke-Az cognitiveservices account list --resource-group $ResourceGroup --output json | ConvertFrom-Json)
if ($Accounts | Where-Object { $_.name -eq $FoundryName }) {
    throw 'This Foundry account already exists. Skip creation and inspect it instead.'
}

Invoke-Az cognitiveservices account create `
    --resource-group $ResourceGroup `
    --name $FoundryName `
    --location $FoundryLocation `
    --kind AIServices `
    --sku S0 `
    --custom-domain $FoundryName `
    --assign-identity `
    --allow-project-management true `
    --yes --output none
```

Treat project-management enablement as a creation-time choice. Do not repurpose
a completed single-service account or replace an existing project's parent.
If only a project is missing, reuse its intended Foundry parent instead.

**Network gate:** creation above follows the supplied basic provisioning command;
it does not create private connectivity or enforce your organization's network
policy. Do not send application data or regard the account as production-ready
until the approved access restrictions/private endpoints and DNS are in place.
Use Entra credentials instead of copying resource keys into configuration.

## 3. Inspect the parent and create only the missing project

```powershell
$Foundry = Invoke-Az cognitiveservices account show `
    --resource-group $ResourceGroup --name $FoundryName --output json | ConvertFrom-Json

if ($Foundry.kind -ne 'AIServices' -or $Foundry.properties.allowProjectManagement -ne $true) {
    throw 'The selected account is not a project-enabled AIServices resource. Review the inventory; do not replace it.'
}
if ($Foundry.properties.provisioningState -ne 'Succeeded' -or -not $Foundry.identity.principalId) {
    throw 'The parent must finish provisioning and have its managed identity enabled before project creation.'
}

Invoke-Az cognitiveservices account project list `
    --resource-group $ResourceGroup --name $FoundryName --output table
```

If the required project is already present, skip this creation block. Otherwise,
use the parent's actual location, not a separately guessed project region:

```powershell
$Projects = @(Invoke-Az cognitiveservices account project list `
    --resource-group $ResourceGroup --name $FoundryName --output json | ConvertFrom-Json)
if ($Projects | Where-Object { ($_.name -split '/')[-1] -eq $FoundryProjectName }) {
    throw 'The project already exists. Read its endpoint instead of recreating it.'
}

Invoke-Az cognitiveservices account project create `
    --resource-group $ResourceGroup `
    --name $FoundryName `
    --project-name $FoundryProjectName `
    --location $Foundry.location `
    --output none
```

Create a project only when it is required by the outstanding row or its intended
application use. Do not add an unused project to an inference-only auxiliary
account just to match the main application.

## 4. Record endpoints and connect the application

```powershell
$Project = Invoke-Az cognitiveservices account project show `
    --resource-group $ResourceGroup --name $FoundryName `
    --project-name $FoundryProjectName --output json | ConvertFrom-Json

if ($Project.properties.provisioningState -ne 'Succeeded') {
    throw 'Project provisioning has not succeeded.'
}
$ProjectEndpoint = $Project.properties.endpoints.'AI Foundry API'
if ([string]::IsNullOrWhiteSpace($ProjectEndpoint)) {
    throw 'The project response did not contain its AI Foundry API endpoint.'
}
$FoundryEndpoint = ([uri]$ProjectEndpoint).GetLeftPart([System.UriPartial]::Authority)

[pscustomobject]@{
    AZURE_AI_PROJECT_ENDPOINT = $ProjectEndpoint
    AZURE_FOUNDRY_ENDPOINT = $FoundryEndpoint
    PROJECT_RESOURCE_ID = $Project.id
}
```

For an **inference-only account**, skip project steps and retrieve the account's
actual endpoints with `Invoke-Az cognitiveservices account show --resource-group
$ResourceGroup --name $FoundryName --query properties.endpoints --output json`.

Use the [main backend configuration example](<../../../Agentic Shiksha Platform/Backend/.env.example>)
and [backend setup guide](<../../../Agentic Shiksha Platform/Backend/README.md>):

| Setting | What to supply |
| --- | --- |
| `AZURE_AI_PROJECT_ENDPOINT` | Full project API endpoint, including `/api/projects/<project>` |
| `AZURE_FOUNDRY_ENDPOINT` | Foundry service base endpoint, not the project ARM ID |
| `PROJECT_RESOURCE_ID` | The project's ARM resource ID, not an inference URL |
| `AZURE_OPENAI_ENDPOINT` | The actual Azure OpenAI endpoint for the account used by those calls |
| `AZURE_AI_AGENT_MODEL_DEPLOYMENT`, `AZURE_OPENAI_CHAT_MODEL`, `AZURE_EVAL_MODEL` | Existing, approved deployment names for the appropriate endpoint |
| `EMBEDDING_MODEL`, `EMBEDDING_DIMENSIONS` | Deployment and dimensions matching the existing Search index |
| `AZURE_IMAGE_ENDPOINT`, `AZURE_IMAGE_MODEL` | Approved image-generation endpoint/deployment; set independently if hosted by an auxiliary account |

Do not overwrite the main project's settings with an image-only account's URL.
Do not change model names or vector dimensions just because a new account was
created. Keep existing Search/Bing connection IDs; verify that each connection is
available to the intended project rather than copying an unrelated project ID.

## 5. Authorize the existing runtime identity

The Foundry account's own identity and the App Service runtime identity are
different principals. Attaching either one does not grant application access.
Have an authorized operator grant only the permissions required on the new
resource/project.

For project API access, the **Foundry User** role was previously named
**Azure AI User**. Its stable built-in role ID avoids the name-transition issue:

```powershell
$RuntimeIdentityId = '<EXISTING_USER_ASSIGNED_IDENTITY_RESOURCE_ID>'
$RuntimePrincipalId = Invoke-Az identity show --ids $RuntimeIdentityId --query principalId --output tsv
if ([string]::IsNullOrWhiteSpace($RuntimePrincipalId)) {
    throw 'The existing runtime identity could not be resolved.'
}

Invoke-Az role assignment create `
    --assignee-object-id $RuntimePrincipalId `
    --assignee-principal-type ServicePrincipal `
    --role '53ca6127-db72-4b80-b1b0-d745d6d5456d' `
    --scope $Project.id --output none
```

Run this only for the runtime identity that needs the project and only if the
assignment is missing. Direct Azure OpenAI calls may additionally require
**Cognitive Services OpenAI User** at their serving account's scope. Other
services have their own data-plane roles. Do not substitute broad subscription
Contributor access or copy account keys to make a permission error disappear.
An inference-only account does not use `$Project.id`; its operator must select
the appropriate account-scoped inference role instead.

## 6. Verify resource setup, then hand off model/application work

```powershell
Invoke-Az cognitiveservices account show --resource-group $ResourceGroup --name $FoundryName `
    --query '{kind:kind,sku:sku.name,location:location,state:properties.provisioningState}' --output table
Invoke-Az cognitiveservices account deployment list --resource-group $ResourceGroup --name $FoundryName `
    --query '[].{deployment:name,model:properties.model.name,state:properties.provisioningState}' --output table
```

- Account/project provisioning must show `Succeeded`.
- An empty deployment list is not a working model. Model deployments, quota,
  named agent definitions, and project connections are a separate readiness gate.
  Resource-only setup does not create or update them.
- Reuse completed monitoring resources only when their linkage is approved;
  creating an Application Insights component does not instrument this backend.
- Check approved network access and a real authorized project/inference request
  before marking the application ready. ARM provisioning success is not that test.

## References

- [Foundry resource/project quickstart](https://learn.microsoft.com/azure/foundry/tutorials/quickstart-create-foundry-resources)
- [Azure CLI: accounts and projects](https://learn.microsoft.com/cli/azure/cognitiveservices/account/project)
- [Foundry role-based access control](https://learn.microsoft.com/azure/foundry/concepts/rbac-foundry)
- [Foundry region support](https://learn.microsoft.com/azure/foundry/reference/region-support)
