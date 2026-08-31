# Creates the COSMOS_DATABASE_V2 Cosmos database and its containers through ARM.
#
# The application principal holds only Cosmos data-plane RBAC, so databases and
# containers cannot be created with the SDK. Partition keys are read from the
# live v1 containers rather than transcribed -- they cannot be changed later.

$ErrorActionPreference = "Stop"

# Target account comes from the environment so this never runs against someone
# else's subscription by default.
$RG      = if ($env:AZURE_RESOURCE_GROUP) { $env:AZURE_RESOURCE_GROUP } else { throw "Set AZURE_RESOURCE_GROUP" }
$ACCOUNT = if ($env:COSMOS_ACCOUNT_NAME)  { $env:COSMOS_ACCOUNT_NAME }  else { throw "Set COSMOS_ACCOUNT_NAME" }
$V1       = if ($env:COSMOS_DATABASE_V1) { $env:COSMOS_DATABASE_V1 } else { "ekalaiva" }
$V2       = if ($env:COSMOS_DATABASE_V2) { $env:COSMOS_DATABASE_V2 } else { throw "Set COSMOS_DATABASE_V2" }

# Referenced by the code but absent from v1, which is why /api/courses 500s.
$EXTRA = @{ "courses_v2" = "/id" }

Write-Output "=== reading v1 container definitions ==="
$rows = az cosmosdb sql container list -g $RG -a $ACCOUNT -d $V1 `
    --query "[].{name:name, pk:resource.partitionKey.paths[0]}" -o tsv
$defs = [ordered]@{}
foreach ($row in $rows) {
    $parts = $row -split "`t"
    if ($parts.Count -ge 2) { $defs[$parts[0]] = $parts[1] }
}
foreach ($k in $EXTRA.Keys) { if (-not $defs.Contains($k)) { $defs[$k] = $EXTRA[$k] } }
foreach ($k in $defs.Keys) { "    {0,-34} pk={1}" -f $k, $defs[$k] }

Write-Output "`n=== creating database $V2 ==="
$exists = az cosmosdb sql database list -g $RG -a $ACCOUNT --query "[?name=='$V2'].name" -o tsv
if ($exists) {
    Write-Output "    already exists"
} else {
    az cosmosdb sql database create -g $RG -a $ACCOUNT -n $V2 --output none
    Write-Output "    created"
}

Write-Output "`n=== creating containers ==="
$present = az cosmosdb sql container list -g $RG -a $ACCOUNT -d $V2 --query "[].name" -o tsv
foreach ($name in $defs.Keys) {
    if ($present -contains $name) {
        "    exists  $name"
        continue
    }
    # Serverless account: throughput must not be specified.
    az cosmosdb sql container create -g $RG -a $ACCOUNT -d $V2 -n $name `
        --partition-key-path $defs[$name] --output none
    "    created $name"
}

Write-Output "`n=== verification: partition keys must match v1 ==="
$after = az cosmosdb sql container list -g $RG -a $ACCOUNT -d $V2 `
    --query "[].{name:name, pk:resource.partitionKey.paths[0]}" -o tsv
$ok = $true
$map = @{}
foreach ($row in $after) {
    $parts = $row -split "`t"
    if ($parts.Count -ge 2) { $map[$parts[0]] = $parts[1] }
}
foreach ($name in $defs.Keys) {
    $want = $defs[$name]
    $got  = $map[$name]
    $good = ($got -eq $want)
    if (-not $good) { $ok = $false }
    "    {0,-34} want={1,-16} got={2,-16} {3}" -f $name, $want, $got, $(if ($good) { "OK" } else { "*** MISMATCH ***" })
}
Write-Output "`nRESULT: $(if ($ok) { 'PASS - all partition keys match v1' } else { 'FAIL - partition key mismatch' })"
if (-not $ok) { exit 1 }
