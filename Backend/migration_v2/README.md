# migration_v2

One-off scripts for the v1 freeze / v2 cutover. **Not imported by the application** — run
them manually, in order, and only when performing that migration.

> These scripts write to and delete from live Azure resources. Read the module docstring
> before running anything here, and prefer a dry run where one is offered.

## Phases

| Phase | Script | Effect |
| --- | --- | --- |
| A | [export_phase1.py](export_phase1.py) | Export everything worth keeping from Phase 1, then verify the archive reads back. Read-only against every source. |
| B | [create_v2_cosmos.ps1](create_v2_cosmos.ps1) | Create the v2 Cosmos database and containers through ARM. |
| B | [create_v2_stores.py](create_v2_stores.py) | Stand up the empty v2 stores by mirroring each live v1 container. |
| C | [clean_v1_contamination.py](clean_v1_contamination.py) | Remove documents written to the frozen v1 database after the cutover. |
| C | [purge_v2_token_usage.py](purge_v2_token_usage.py) | Remove Phase 1 token-usage telemetry back-filled into v2. |
| D | [delete_phase1_tas.py](delete_phase1_tas.py) | Delete the Phase 1 TA agents from Foundry. **Irreversible.** |

## Safety properties

These were designed so a mistake is recoverable:

- **Phase A is read-only** and verifies the archive can be read back before anything else
  runs. Do not skip it.
- **`clean_v1_contamination.py` deletes only on two independent conditions** — a document
  must be absent from the archive *and* meet the post-cutover test. One condition alone is
  not enough.
- **`delete_phase1_tas.py` re-verifies every agent against the blob archive immediately
  before deletion**, rather than trusting a list captured earlier.
- **`purge_v2_token_usage.py`** exists because startup reconciliation is watermark-based
  and incremental, so it will not correct a bad back-fill on its own.

## Configuration

Required beyond the usual backend variables — all documented in
[../.env.example](../.env.example):

`AZURE_RESOURCE_GROUP`, `COSMOS_ACCOUNT_NAME`, `COSMOS_DATABASE_V1`,
`COSMOS_DATABASE_V2`, `STORAGE_ACCOUNT_NAME`, `SUPER_ADMIN_EMAIL`.

`create_v2_cosmos.ps1` throws rather than defaulting when the account or target database
is unset, so it cannot silently write to the wrong database.
