# Set up the remaining Azure resources

[Installation](../../INSTALL.md) | [Deployment guidance](../deployment.md) | [Documentation index](../README.md)

These READMEs cover **only the remaining Microsoft Foundry and App Service
resources**. They adapt the supplied Azure CLI commands to PowerShell and the
application's existing configuration. They are instructions, not a deployment
script or evidence that anything has been provisioned.

## Scope: only rows marked `Mandatory = 1`

The resource inventory containing that column was not included with the supplied
commands. Consequently, no concrete resource names, counts, or completion states
are inferred here. Copy the names and purpose of the outstanding rows from your
inventory before running any creation command.

| Outstanding resource type | Setup guide | Supplied baseline |
| --- | --- | --- |
| Foundry account and, where needed, its project | [Microsoft Foundry](foundry/README.md) | `AIServices`, `S0`, `westus3` |
| Linux App Service web app | [App Service](app-service/README.md) | Reuse the existing Linux plan |
| App Service plan, **only if the plan itself is an outstanding row** | [Conditional plan creation](app-service/README.md#2-reuse-the-linux-plan) | `B1`, Linux, `westus2` |

Do **not** recreate completed Bing Search/Custom Search, Search, Document
Intelligence, Speech, Cosmos DB, Storage, managed identity, registry, monitoring,
VNet, subnet, NSG, or Private DNS resources. The supplied MongoDB and NoSQL Cosmos
accounts serve different APIs; neither is a replacement for the other.

Account creation does not deploy models or agents. Plan creation does not create
web apps. A web app's existence does not prove that application configuration,
authentication, private connectivity, or health checks are complete.

## Shared prerequisites

- Azure CLI **2.80.0 or later**; the documented flags were checked against 2.80.0.
- Authorization for the intended subscription and existing resource group.
  Resource creation normally requires Contributor at the appropriate scope.
  Role assignments additionally require an authorized role-assignment operator;
  do not grant subscription-wide Owner/Contributor to an application identity.
- Approved names, regions, quotas, costs, and network policy for the outstanding
  rows. Keep the supplied regions unless your inventory explicitly changes them.
- Existing dependencies and an approved source for server-only configuration.
  Never commit real resource identifiers, credentials, keys, or populated `.env`
  files. All names below are placeholders.

### PowerShell session

Run this block once in the terminal used for either resource guide. Replace the
two placeholders first. `Invoke-Az` stops on a native CLI failure, so a failed
lookup cannot silently become an empty resource ID in a later command.

```powershell
$SubscriptionId = '<SUBSCRIPTION_ID>'
$ResourceGroup = '<RESOURCE_GROUP_NAME>'
$ErrorActionPreference = 'Stop'

function Invoke-Az {
    & az @args
    if ($LASTEXITCODE -ne 0) {
        throw "Azure CLI failed with exit code $LASTEXITCODE. Stop and inspect the preceding error."
    }
}

Invoke-Az version
Invoke-Az login --output none
Invoke-Az account set --subscription $SubscriptionId
Invoke-Az account show --query '{subscription:name,subscriptionId:id,tenant:tenantId}' --output table
Invoke-Az group show --name $ResourceGroup --query '{name:name,location:location,state:properties.provisioningState}' --output table
```

Review the selected context before continuing. Do not create another resource
group to work around a failed lookup or permission error. PowerShell uses the
backtick for line continuation; the Bash `\` continuations in the supplied
commands cannot be pasted unchanged into PowerShell.

If Azure reports an unregistered provider, have the subscription operator review
registration of `Microsoft.CognitiveServices` or `Microsoft.Web`, as applicable.
Do not change policy, region, or SKU merely to bypass a deployment error.

## Completion record

For each outstanding inventory row, record in your private operational inventory:

- The created resource ID and provisioning result.
- The existing dependencies reused, identity, and scoped permissions.
- For Foundry: project ID, project endpoint, and separately verified deployments.
- For App Service: plan ID, image tag/digest, container port, and access policy.
- Any remaining network, authentication, model, or application-configuration work.

Keep private endpoint DNS records tied to the private endpoint's DNS zone group.
Do not copy old private IP addresses into these READMEs. The existing MongoDB
Private DNS zone does not establish private access to Foundry or App Service.

No Azure creation, update, role-assignment, or deployment commands were executed
as part of writing these guides.
