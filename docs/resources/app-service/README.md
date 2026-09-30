# Set up outstanding Linux App Service resources

[Resource setup scope and prerequisites](../README.md) | [Microsoft Foundry](../foundry/README.md) | [Deployment guidance](../../deployment.md)

Use this guide only for App Service rows marked `Mandatory = 1` in your inventory.
Reuse the completed registry, managed identity, network, and Linux plan. An
existing plan is not an existing web app: each deployed service has its own app.
Do not create all four applications unless all four are outstanding.

Run the [shared PowerShell session](../README.md#powershell-session) first.
This guide uses the repository's **classic Linux custom-container** hosting path,
not sidecars, code-only Python deployment, or a new deployment tool.

## 1. Choose one outstanding app and its existing image

| Application | Dockerfile / build context | Container HTTP port |
| --- | --- | --- |
| Main backend | [Platform Backend](<../../../Agentic Shiksha Platform/Backend/Dockerfile>) | `8080`; process honors `PORT` |
| Main frontend, including teacher dashboard | [Platform Frontend](<../../../Agentic Shiksha Platform/Frontend/Dockerfile>) | `80` |
| Standalone admin backend | [Admin backend](../../../Admin-Dashboard/backend/Dockerfile) | `8050` |
| Standalone admin frontend | [Admin frontend](../../../Admin-Dashboard/frontend/Dockerfile) | `80` |

Select an already built, approved Linux image for that service. Do not use a
development-server port or a fifth, combined platform image. Image builds and
pushes are outside this resource-only guide.

```powershell
$WebAppName = '<OUTSTANDING_WEB_APP_NAME>'
$PlanResourceGroup = '<EXISTING_PLAN_RESOURCE_GROUP>'
$PlanName = '<APP_SERVICE_PLAN_NAME>'
$RegistryResourceGroup = '<EXISTING_REGISTRY_RESOURCE_GROUP>'
$RegistryName = '<CONTAINER_REGISTRY_NAME>'
$RuntimeIdentityId = '<EXISTING_USER_ASSIGNED_IDENTITY_RESOURCE_ID>'
$ImageRepositoryAndTag = '<IMAGE_REPOSITORY>:<IMMUTABLE_RELEASE_TAG>'
$ContainerPort = 8080
```

`8080` above is the main-backend example. Change it to `80` or `8050` only when
selecting the matching service from the table. Use a release-specific image tag
or approved digest, not a mutable `latest` tag.

## 2. Reuse the Linux plan

```powershell
$Plan = Invoke-Az appservice plan show --resource-group $PlanResourceGroup `
    --name $PlanName --output json | ConvertFrom-Json
if ($Plan.reserved -ne $true) {
    throw 'The selected plan is not Linux. Select the existing approved Linux plan.'
}

$Plan | Select-Object name, location, reserved, sku
```

The supplied plan baseline is **Linux / B1 / westus2**. Apps inherit their plan's
region; do not change the plan's region/SKU to match another dependency's region.
Apps on one plan share its compute capacity. B1 is not a claim that all four
services, native tools, and background workers fit that plan.

**Only if the plan itself is marked `Mandatory = 1` and confirmed absent**, run
the supplied creation command below, then rerun the lookup above. A failed
lookup due to permissions or the wrong resource group is not evidence of absence.

```powershell
Invoke-Az appservice plan list --resource-group $PlanResourceGroup `
    --query '[].{name:name,location:location,linux:reserved,sku:sku.name}' --output table

$Plans = @(Invoke-Az appservice plan list --resource-group $PlanResourceGroup --output json | ConvertFrom-Json)
if ($Plans | Where-Object { $_.name -eq $PlanName }) {
    throw 'The plan already exists. Reuse it; do not recreate or resize it.'
}

Invoke-Az appservice plan create `
    --resource-group $PlanResourceGroup `
    --name $PlanName `
    --location westus2 `
    --sku B1 `
    --is-linux --output none
```

Skip that entire block when the plan is already complete.

## 3. Check the existing registry and identity

```powershell
$Registry = Invoke-Az acr show --resource-group $RegistryResourceGroup `
    --name $RegistryName --output json | ConvertFrom-Json
$RuntimeIdentity = Invoke-Az identity show --ids $RuntimeIdentityId --output json | ConvertFrom-Json
if (-not $Registry.id -or -not $Registry.loginServer -or -not $RuntimeIdentity.principalId) {
    throw 'Resolve the existing registry and managed identity before creating the app.'
}
$ContainerImage = "$($Registry.loginServer)/$ImageRepositoryAndTag"

$Registry | Select-Object name, loginServer, roleAssignmentMode
```

Confirm the selected image exists in this registry. Image-pull authorization is
separate from the application's Foundry/Search/Storage/Cosmos permissions:

| Registry permissions mode | Pull role |
| --- | --- |
| RBAC Registry Permissions | `AcrPull` |
| RBAC Registry + ABAC Repository Permissions | `Container Registry Repository Reader`; apply approved repository conditions where required |

If the existing identity lacks pull access, have the registry's role-assignment
operator grant the corresponding role. Do not enable the ACR admin user or add
registry passwords to the app.

```powershell
$PullRole = '<PULL_ROLE_FROM_THE_TABLE>'
if ($PullRole -notin @('AcrPull', 'Container Registry Repository Reader')) {
    throw 'Select the pull role that matches the registry permissions mode.'
}
Invoke-Az role assignment create `
    --assignee-object-id $RuntimeIdentity.principalId `
    --assignee-principal-type ServicePrincipal `
    --role $PullRole --scope $Registry.id --output none
```

Skip role creation when suitable access already exists. Repository-scoped ABAC
conditions must be supplied by the operator rather than replaced by an
unconditional registry-wide assignment. Allow time for RBAC propagation.
Network-protected registries also require working network/DNS reachability;
RBAC alone cannot make the image pull succeed.

## 4. Create only the missing app

The app starts with **public access disabled** so that provisioning does not
expose an unconfigured API. This does not itself create a private endpoint.

```powershell
$Apps = @(Invoke-Az webapp list --resource-group $ResourceGroup --output json | ConvertFrom-Json)
if ($Apps | Where-Object { $_.name -eq $WebAppName }) {
    throw 'This web app already exists. Do not overwrite its image or configuration.'
}

Invoke-Az webapp create `
    --resource-group $ResourceGroup `
    --name $WebAppName `
    --plan $Plan.id `
    --container-image-name $ContainerImage `
    --assign-identity $RuntimeIdentity.id `
    --acr-use-identity `
    --acr-identity $RuntimeIdentity.id `
    --sitecontainers-app false `
    --https-only true `
    --public-network-access Disabled `
    --output none

Invoke-Az webapp config set --resource-group $ResourceGroup --name $WebAppName `
    --always-on true --min-tls-version 1.2 --ftps-state Disabled --output none
Invoke-Az webapp config appsettings set --resource-group $ResourceGroup --name $WebAppName `
    --settings "WEBSITES_PORT=$ContainerPort" --output none
```

The managed identity's **resource ID** is passed to `--acr-identity`.
App Service's resulting `acrUserManagedIdentityID` configuration uses its
**client ID**; these identifiers are not interchangeable.
Do not override the Dockerfile startup command with a local development command.

`WEBSITES_PORT` is for this classic custom-container path. A sidecar-enabled app
uses its main container's `targetPort` instead; do not apply this recipe to an
existing sidecar app or assume these two settings are equivalent.

## 5. Supply configuration without recreating dependencies

Use App Service settings or the environment's approved secret store for
server-only settings. Do not check in private `.env` files or paste secrets into
CLI history/output. Review the complete service configuration, not just this
short identity example.

For a **new main-backend app only**, the existing credential helper supports:

```powershell
Invoke-Az webapp config appsettings set --resource-group $ResourceGroup --name $WebAppName `
    --settings AZURE_AUTH_MODE=default `
    "AZURE_CLIENT_ID=$($RuntimeIdentity.clientId)" "PORT=$ContainerPort" `
    --output none
```

Then supply the full
[backend configuration](<../../../Agentic Shiksha Platform/Backend/.env.example>),
including the [Foundry outputs](../foundry/README.md#4-record-endpoints-and-connect-the-application),
completed data/search resources, session/OAuth configuration, and correct
frontend/backend origins. The
configuration is not a complete standalone configuration. Managed identity does not replace
the application's user authentication or required server secrets.

For the other services, follow their own configuration:

- [Main frontend](<../../../Agentic Shiksha Platform/Frontend/README.md>):
  its Docker build consumes production Vite settings and generates the backend
  CSP origin. Changing `VITE_*` App Service settings after the image is built
  does not rewrite its browser bundle.
- [Admin backend](../../../Admin-Dashboard/backend/README.md):
  use its independent environment contract and port `8050`.
- [Admin frontend](../../../Admin-Dashboard/frontend/README.md):
  configure both main-API and dashboard-API origins at build time. It is not the
  embedded teacher dashboard.

Keep public access disabled until an approved access path and authentication
are configured. In particular, the standalone admin API requires a private,
independently authenticated boundary; CORS and a frontend login are not that
boundary. See [deployment security requirements](../../deployment.md).
This guide deliberately does not enable public ingress, create network resources,
or claim that existing MongoDB private DNS is sufficient.

## 6. Verify the resource, then application readiness

These queries avoid returning app secrets:

```powershell
Invoke-Az webapp show --resource-group $ResourceGroup --name $WebAppName `
    --query '{name:name,state:state,host:defaultHostName,plan:serverFarmId,httpsOnly:httpsOnly,publicNetworkAccess:publicNetworkAccess}' --output json
Invoke-Az webapp config show --resource-group $ResourceGroup --name $WebAppName `
    --query '{image:linuxFxVersion,alwaysOn:alwaysOn,minTls:minTlsVersion,acrIdentity:acrUserManagedIdentityID,managedIdentityPull:acrUseManagedIdentityCreds}' --output json
Invoke-Az webapp config appsettings list --resource-group $ResourceGroup --name $WebAppName `
    --query "[?name=='WEBSITES_PORT' || name=='PORT'].{name:name,value:value}" --output table
```

Check the selected plan/image, HTTPS, identity-based registry pull, and the
correct port. A `Running` app resource can still have a failing container.
Through the approved network path, verify startup, a service-appropriate health
request, user login, API/streaming traffic, and dependency access before calling
the application ready. An external `403` while public access is disabled is not
an application health test. Do not enable public access merely to get a `200`.

On a pull failure, check the image tag, registry role mode, identity client ID,
RBAC propagation, and registry network access. On startup failure, inspect
restricted logs for missing configuration or the wrong port; do not publish
logs containing credentials or learner data.

## References

- [Azure CLI: web app creation](https://learn.microsoft.com/cli/azure/webapp#az-webapp-create)
- [App Service custom containers, identity and ports](https://learn.microsoft.com/azure/app-service/configure-custom-container)
- [Sidecar-enabled custom containers](https://learn.microsoft.com/azure/app-service/configure-sidecar)
- [ACR repository permissions and ABAC](https://learn.microsoft.com/azure/container-registry/container-registry-rbac-abac-repository-permissions)
