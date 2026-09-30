# agent_info_tool.py
from __future__ import annotations
import asyncio, json, inspect
from typing import Any, Callable, Dict, Iterable, List, Optional, Set, Union

from azure.identity.aio import AzureCliCredential
from azure.ai.agents.aio import AgentsClient

Scalar = Union[str, int, float, bool, None]
MappingLike = Dict[str, Any]


def _is_public(name: str) -> bool:
    return not name.startswith("_")

def _is_scalar(x: Any) -> bool:
    return isinstance(x, (str, int, float, bool, type(None)))

def _is_collection(x: Any) -> bool:
    return isinstance(x, (list, tuple, set))

def _iter_attrs(obj: Any) -> Iterable[tuple[str, Any]]:
    # Prefer pydantic/msrest style dicts if available
    if hasattr(obj, "model_dump") and callable(getattr(obj, "model_dump")):
        try:
            d = obj.model_dump()  # pydantic v2
            for k, v in d.items():
                yield k, v
            return
        except Exception:
            pass
    if hasattr(obj, "as_dict") and callable(getattr(obj, "as_dict")):
        try:
            d = obj.as_dict()  # msrest-style
            for k, v in d.items():
                yield k, v
            return
        except Exception:
            pass
    if hasattr(obj, "dict") and callable(getattr(obj, "dict")):
        try:
            d = obj.dict()  # pydantic v1
            for k, v in d.items():
                yield k, v
            return
        except Exception:
            pass
    # Fallback: __dict__ + public attributes (non-callables)
    seen = set()
    if hasattr(obj, "__dict__"):
        for k, v in obj.__dict__.items():
            if _is_public(k):
                seen.add(k)
                yield k, v
    # Also probe attributes visible on dir()
    for name in dir(obj):
        if name in seen or not _is_public(name):
            continue
        try:
            val = getattr(obj, name)
        except Exception:
            continue
        if not callable(val) and not inspect.ismethoddescriptor(val):
            yield name, val

def _to_plain(
    obj: Any,
    *,
    depth: int,
    max_items: int = 100,
) -> Any:
    """Best-effort serializer with depth control."""
    if depth < 0:
        return str(type(obj).__name__)
    if _is_scalar(obj):
        return obj
    if _is_collection(obj):
        out = []
        for i, item in enumerate(obj):
            if i >= max_items:
                out.append("...truncated...")
                break
            out.append(_to_plain(item, depth=depth - 1, max_items=max_items))
        return out
    if isinstance(obj, dict):
        out: Dict[str, Any] = {}
        for i, (k, v) in enumerate(obj.items()):
            if i >= max_items:
                out["...truncated..."] = True
                break
            out[str(k)] = _to_plain(v, depth=depth - 1, max_items=max_items)
        return out
    # SDK/model objects
    result: Dict[str, Any] = {}
    for k, v in _iter_attrs(obj):
        result[k] = _to_plain(v, depth=depth - 1, max_items=max_items)
    return result or str(obj)

def _filter_fields(
    row: MappingLike,
    *,
    include: Optional[Set[str]] = None,
    exclude: Optional[Set[str]] = None,
) -> MappingLike:
    if include:
        return {k: v for k, v in row.items() if k in include}
    if exclude:
        return {k: v for k, v in row.items() if k not in exclude}
    return row

class AgentInfoTool:
    """
    List/inspect Azure AI Foundry agents with flexible attribute control.

    Examples:
        tool = AgentInfoTool(endpoint, credential_factory=lambda: AzureCliCredential(process_timeout=60))

        # 1) Get EVERYTHING we can serialize (depth=2)
        agents = await tool.list_agents_all_attrs(depth=2)

        # 2) Only a few fields
        agents = await tool.list_agents_selected(include={"id","name","model_deployment_name"})

        # 3) Show as JSON
        print(await tool.list_agents_json(include={"id","name"}, indent=2))
    """

    def __init__(
        self,
        project_endpoint: str,
        credential_factory: Optional[Callable[[], AzureCliCredential]] = None,
    ) -> None:
        if not project_endpoint:
            raise ValueError("project_endpoint is required.")
        self.project_endpoint = project_endpoint
        self.credential_factory = credential_factory or (lambda: AzureCliCredential())

    async def _pager(self, *, limit: int = 100):
        cred = self.credential_factory()
        agents_client = AgentsClient(endpoint=self.project_endpoint, credential=cred)
        try:
            yield agents_client.list_agents(limit=limit)
        finally:
            await agents_client.close()
            await cred.close()

    async def list_agents_all_attrs(
        self,
        *,
        limit: int = 100,
        depth: int = 2,
        exclude: Optional[Set[str]] = None,
    ) -> List[Dict[str, Any]]:
        """Return each agent as a big dict of (almost) all attributes we can discover."""
        rows: List[Dict[str, Any]] = []
        async for pager in self._pager(limit=limit):
            async for a in pager:
                row = _to_plain(a, depth=depth)
                if isinstance(row, dict):
                    row = _filter_fields(row, exclude=exclude)
                rows.append(row if isinstance(row, dict) else {"value": row})
        return rows

    async def list_agents_selected(
        self,
        *,
        include: Optional[Set[str]] = None,
        exclude: Optional[Set[str]] = None,
        limit: int = 100,
        depth: int = 2,
    ) -> List[Dict[str, Any]]:
        """
        Return only chosen attributes (include) or everything minus excluded (exclude).
        If include is provided, exclude is ignored.
        """
        rows: List[Dict[str, Any]] = []
        async for pager in self._pager(limit=limit):
            async for a in pager:
                full = _to_plain(a, depth=depth)
                if not isinstance(full, dict):
                    rows.append({"value": full})
                    continue
                rows.append(_filter_fields(full, include=include, exclude=exclude))
        return rows

    async def list_agents_json(
        self,
        *,
        include: Optional[Set[str]] = None,
        exclude: Optional[Set[str]] = None,
        limit: int = 100,
        depth: int = 2,
        indent: Optional[int] = 2,
    ) -> str:
        data = await self.list_agents_selected(include=include, exclude=exclude, limit=limit, depth=depth)
        return json.dumps(data, ensure_ascii=False, indent=indent)

    async def find_by_name(
        self,
        name: str,
        *,
        case_insensitive: bool = True,
        include: Optional[Set[str]] = None,
        exclude: Optional[Set[str]] = None,
        limit: int = 100,
        depth: int = 2,
    ) -> Optional[Dict[str, Any]]:
        target = name.lower() if case_insensitive else name
        async for pager in self._pager(limit=limit):
            async for a in pager:
                full = _to_plain(a, depth=depth)
                if not isinstance(full, dict):
                    continue
                n = (
                    full.get("name")
                    or full.get("agent_name")
                    or (full.get("properties") or {}).get("name")
                )
                if not n:
                    continue
                key = n.lower() if case_insensitive else n
                if key == target:
                    return _filter_fields(full, include=include, exclude=exclude)
        return None

    async def exists(self, name: str, *, case_insensitive: bool = True, limit: int = 100) -> bool:
        return (await self.find_by_name(name, case_insensitive=case_insensitive, limit=limit)) is not None

    async def print_table(
        self, *,
        columns: Optional[List[str]] = None,
        limit: int = 200,
        depth: int = 1,
    ) -> None:
        """
        Pretty-print a table of selected columns.
        Defaults to commonly useful ones if columns is None.
        """
        default_cols = ["id", "name", "model", "model_deployment_name", "status", "updated_at", "created_at"]
        cols = columns or default_cols
        rows = await self.list_agents_selected(include=set(cols), limit=limit, depth=depth)

        if not rows:
            print("No agents found.")
            return
        # compute widths
        widths = {c: max(len(c), *(len(str(r.get(c, ""))) for r in rows)) for c in cols}
        def line(vals): return " | ".join(str(vals.get(c, "")).ljust(widths[c]) for c in cols)
        print(line({c: c for c in cols}))
        print("-+-".join("-" * widths[c] for c in cols))
        for r in rows:
            print(line(r))


# --- Example usage ---
if __name__ == "__main__":
    import os
    from dotenv import load_dotenv
    load_dotenv()

    ENDPOINT = os.getenv("AZURE_AI_PROJECT_ENDPOINT")
    cred_factory = lambda: AzureCliCredential(process_timeout=60)
    tool = AgentInfoTool(ENDPOINT, credential_factory=cred_factory)

    async def demo():
        # 1) All attributes (depth-limited)
        all_rows = await tool.list_agents_all_attrs(depth=2)
        print(f"Found {len(all_rows)} agent(s); first keys:", list(all_rows[0].keys()) if all_rows else [])

        # 2) Only specific fields
        rows = await tool.list_agents_selected(include={"id", "name", "model_deployment_name", "status"})
        print(json.dumps(rows, indent=2))

        # 3) Table view with chosen columns
        await tool.print_table(columns=["id", "name", "status", "model_deployment_name"])

    asyncio.run(demo())