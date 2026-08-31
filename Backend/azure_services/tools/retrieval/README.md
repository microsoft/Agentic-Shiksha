# azure_services/tools/retrieval

Retrieval helpers layered over [../search/](../search).

Where `search/` owns index lifecycle and raw query execution, this package is the seam
for shaping retrieved chunks into the context an agent receives — selection, ordering and
trimming to fit the prompt budget.

Currently a thin subpackage; most retrieval still runs through the hosted Azure AI Search
tool in [agent_tools/hosted/azure_ai_search/](../../../agent_tools/hosted/azure_ai_search),
which Foundry executes server-side.
