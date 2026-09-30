"""Rebuild the static API inventory; never import or run application code.

From the repository root:
    C:\\Python314\\python.exe -B docs\\workflows\\tools\\inventory.py
    C:\\Python314\\python.exe -B docs\\workflows\\tools\\inventory.py --check
    C:\\Python314\\python.exe -B -m unittest discover -s docs\\workflows\\tools

This is a deliberately bounded symbolic interpreter, not a Python runtime.
Unknown routing expressions retain their source locations and classifications.
The independent declaration scan reconciles declarations, not live OpenAPI.
"""

from __future__ import annotations

import argparse
import ast
from collections import Counter
from dataclasses import dataclass, field
import hashlib
import io
import json
import os
from pathlib import Path
import re
import sys
import tokenize
from typing import Any


SNAPSHOT = "2026-09-30"
HTTP_VERBS = {"get", "post", "put", "patch", "delete", "options", "head", "trace"}
PATH_PARAMETER = re.compile(r"\{[a-zA-Z_][a-zA-Z0-9_]*(?::([a-zA-Z_][a-zA-Z0-9_]*))?\}")
PATH_CONVERTERS = {
    "str": r"[^/]+",
    "path": r".*",
    "int": r"[0-9]+",
    "float": r"[0-9]+(?:\.[0-9]+)?",
    "uuid": r"[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}",
}
DECORATORS = HTTP_VERBS | {"api_route", "route", "websocket", "websocket_route"}
ADD_ROUTES = {"add_api_route", "add_route", "add_api_websocket_route", "add_websocket_route"}
ASSEMBLY = ADD_ROUTES | {"include_router", "mount"}
HARD_EXCLUDED = {".git", ".venv", "venv", "env", "__pycache__", "node_modules", "tests", "test", "user_data"}
SOFT_EXCLUDED = {"scripts", "migrations"}
SERVICE_SPECS = (
    ("main", "Agentic Shiksha Platform/Backend", "backend.main", "app"),
    ("admin", "Admin-Dashboard/backend", "main", "app"),
)


def expression(node: ast.AST | None) -> str:
    return ast.unparse(node) if node is not None else ""


def keyword(call: ast.Call, name: str) -> ast.AST | None:
    return next((item.value for item in call.keywords if item.arg == name), None)


def argument(call: ast.Call, position: int, name: str) -> ast.AST | None:
    return call.args[position] if len(call.args) > position else keyword(call, name)


def unique(items: list[dict]) -> list[dict]:
    return list({json.dumps(item, sort_keys=True): item for item in items}.values())


def declaration_id(source: str, node: ast.Call) -> str:
    return f"{source}:{node.lineno}:{node.col_offset}"


@dataclass(eq=False)
class Source:
    path: str
    data: bytes
    text: str = field(init=False)
    tree: ast.Module = field(init=False)
    names: dict[int, str] = field(init=False, default_factory=dict)
    parents: dict[int, ast.AST] = field(init=False, default_factory=dict)

    def __post_init__(self) -> None:
        encoding, _ = tokenize.detect_encoding(io.BytesIO(self.data).readline)
        self.text = self.data.decode(encoding)
        self.tree = ast.parse(self.text, filename=self.path)
        for parent in ast.walk(self.tree):
            for child in ast.iter_child_nodes(parent):
                self.parents[id(child)] = parent

        def qualify(node: ast.AST, scope: str = "") -> None:
            for child in ast.iter_child_nodes(node):
                child_scope = scope
                if isinstance(child, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
                    name = scope + child.name
                    self.names[id(child)] = name
                    child_scope = name + ("." if isinstance(child, ast.ClassDef) else ".<locals>.")
                qualify(child, child_scope)

        qualify(self.tree)

    def location(self, node: ast.AST, **extra: Any) -> dict:
        return {"source": self.path, "line": node.lineno, "expression": expression(node), **extra}


class Sources:
    def __init__(self, root: Path, supplied: dict[str, str] | None = None):
        self.root = root
        self.supplied = supplied
        self.loaded: dict[str, Source] = {}

    def exists(self, path: str) -> bool:
        if self.supplied is not None:
            return path in self.supplied
        return self.root.joinpath(*path.split("/")).is_file()

    def get(self, path: str) -> Source:
        if path not in self.loaded:
            data = (
                self.supplied[path].encode("utf-8")
                if self.supplied is not None
                else self.root.joinpath(*path.split("/")).read_bytes()
            )
            self.loaded[path] = Source(path, data)
        return self.loaded[path]

    def scan(self, root: str) -> list[str]:
        if self.supplied is not None:
            candidates = sorted(path for path in self.supplied if path.startswith(root + "/"))
        else:
            candidates = []
            for directory, names, files in os.walk(self.root.joinpath(*root.split("/"))):
                names[:] = sorted(
                    name for name in names if name.lower() not in HARD_EXCLUDED | SOFT_EXCLUDED
                )
                candidates.extend(
                    (Path(directory) / name).relative_to(self.root).as_posix()
                    for name in sorted(files)
                    if name.endswith(".py")
                )
        return [
            path for path in candidates
            if path.endswith(".py")
            and not set(part.lower() for part in path[len(root) + 1:].split("/")) & (HARD_EXCLUDED | SOFT_EXCLUDED)
            and not Path(path).name.startswith("test_")
            and not Path(path).name.endswith("_test.py")
        ]

    def module_path(self, root: str, name: str) -> str | None:
        parts = name.split(".")
        if not all(part.isidentifier() for part in parts):
            return None
        if set(part.lower() for part in parts) & HARD_EXCLUDED:
            return None
        stem = root + "/" + "/".join(parts)
        return next((path for path in (stem + ".py", stem + "/__init__.py") if self.exists(path)), None)


def scan_declarations(source: Source) -> dict[str, dict]:
    """Independent syntax census: it does not use symbol or mount resolution."""
    found: dict[str, dict] = {}
    decorator_nodes: set[int] = set()
    for node in ast.walk(source.tree):
        if not isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            continue
        for decorator in node.decorator_list:
            if isinstance(decorator, ast.Call) and isinstance(decorator.func, ast.Attribute):
                if decorator.func.attr in DECORATORS:
                    decorator_nodes.add(id(decorator))
                    found[declaration_id(source.path, decorator)] = {
                        "node": decorator,
                        "handler": source.names[id(node)],
                        "definition_line": node.lineno,
                        "kind": "decorator",
                    }
    for node in ast.walk(source.tree):
        if not isinstance(node, ast.Call) or not isinstance(node.func, ast.Attribute):
            continue
        if node.func.attr in ADD_ROUTES:
            endpoint = argument(node, 1, "endpoint")
            found[declaration_id(source.path, node)] = {
                "node": node,
                "handler": expression(endpoint),
                "definition_line": None,
                "kind": "registration-call",
            }
        elif node.func.attr in DECORATORS and id(node) not in decorator_nodes:
            parent = source.parents.get(id(node))
            if isinstance(parent, ast.Call) and parent.func is node:
                found[declaration_id(source.path, node)] = {
                    "node": node,
                    "handler": expression(argument(parent, 0, "endpoint")),
                    "definition_line": None,
                    "kind": "applied-decorator",
                }
    return found


@dataclass(eq=False)
class External:
    name: str


@dataclass(eq=False)
class Imported:
    module: str
    symbol: str | None
    origin: Module
    node: ast.AST


@dataclass(eq=False)
class Expr:
    node: ast.AST | None
    module: Module
    env: dict
    reason: str = "not a statically evaluable literal"


@dataclass(eq=False)
class Function:
    node: ast.FunctionDef | ast.AsyncFunctionDef
    module: Module
    env: dict
    name: str


@dataclass(eq=False)
class Module:
    source: Source
    name: str
    env: dict = field(default_factory=dict)
    loaded: bool = False


@dataclass(eq=False)
class Router:
    module: Module
    node: ast.Call
    kind: str
    prefix: Any
    dependencies: list[dict]
    conditions: list[dict]
    settings: dict
    records: list[dict] = field(default_factory=list)

    def evidence(self) -> dict:
        return {
            **self.module.source.location(self.node),
            "kind": self.kind,
            "prefix": self.prefix if isinstance(self.prefix, str) else None,
            "prefix_expression": expression(keyword(self.node, "prefix")) or "''",
            "dependencies": [item["expression"] for item in self.dependencies],
        }


class Analyzer:
    def __init__(self, sources: Sources, service: str, root: str, entry: str, binding: str):
        self.sources, self.service, self.root = sources, service, root
        self.entry, self.binding = entry, binding
        self.modules: dict[str, Module] = {}
        self.scanned = set(sources.scan(root))
        self.relevant: set[str] = set()
        self.declared_records: dict[str, list[dict]] = {}
        self.unresolved: list[dict] = []
        self.inactive: dict[str, str] = {}
        self.call_stack: list[Function] = []
        self.resolving: set[int] = set()
        self.module_imports: set[str] = set()
        self.overwrites: list[dict] = []

    def issue(self, module: Module, node: ast.AST, kind: str, reason: str, classification: str = "unresolved") -> None:
        self.relevant.add(module.source.path)
        self.unresolved.append({
            "service": self.service, **module.source.location(node),
            "kind": kind, "classification": classification, "reason": reason,
        })

    def load(self, name: str) -> Module | External:
        path = self.sources.module_path(self.root, name)
        if path is None:
            return External(name)
        if name in self.modules:
            return self.modules[name]
        module = Module(self.sources.get(path), name)
        self.modules[name] = module
        self.scanned.add(path)
        self.execute(module.source.tree.body, module.env, module, [])
        module.loaded = True
        return module

    def resolve(self, value: Any, routing: bool = False) -> Any:
        if not isinstance(value, Imported):
            return value
        if id(value) in self.resolving:
            return Expr(value.node, value.origin, value.origin.env, "cyclic import binding")
        self.resolving.add(id(value))
        try:
            module = self.load(value.module)
            if isinstance(module, External):
                return External(value.module + ("." + value.symbol if value.symbol else ""))
            if routing:
                self.relevant.update((value.origin.source.path, module.source.path))
            if value.symbol is None:
                return module
            if value.symbol in module.env:
                return self.resolve(module.env[value.symbol], routing)
            submodule = self.load(value.module + "." + value.symbol)
            if isinstance(submodule, Module):
                return submodule
            return Expr(value.node, value.origin, value.origin.env, "unresolved imported binding")
        finally:
            self.resolving.remove(id(value))

    def evaluate(self, node: ast.AST | None, env: dict, module: Module, conditions: list[dict], routing: bool = False) -> Any:
        unknown = Expr(node, module, env.copy())
        if node is None:
            return None
        if isinstance(node, ast.Constant):
            return node.value
        if isinstance(node, ast.Name):
            value = self.resolve(env.get(node.id, unknown), routing)
            if isinstance(value, Expr) and routing and value.node is not node and id(value) not in self.resolving:
                self.resolving.add(id(value))
                try:
                    return self.evaluate(value.node, value.env, value.module, conditions, routing=True)
                finally:
                    self.resolving.remove(id(value))
            return value
        if isinstance(node, ast.Attribute):
            value = self.evaluate(node.value, env, module, conditions, routing)
            if isinstance(value, Module):
                if node.attr in value.env:
                    return self.resolve(value.env[node.attr], routing)
                nested = self.load(value.name + "." + node.attr)
                return nested if isinstance(nested, Module) else unknown
            if isinstance(value, External):
                name = value.name + "." + node.attr
                nested = self.load(name)
                return nested if isinstance(nested, Module) else External(name)
            if isinstance(value, Router) and node.attr == "router":
                return value
            if isinstance(value, dict):
                return value.get(node.attr, unknown)
            return unknown
        if isinstance(node, (ast.List, ast.Tuple, ast.Set)):
            values = [self.evaluate(item, env, module, conditions, routing) for item in node.elts]
            return tuple(values) if isinstance(node, ast.Tuple) else values
        if isinstance(node, ast.Dict) and all(key is not None for key in node.keys):
            keys = [self.evaluate(key, env, module, conditions, routing) for key in node.keys]
            if all(isinstance(key, (str, int, float, bool, type(None))) for key in keys):
                return dict(zip(keys, [self.evaluate(item, env, module, conditions, routing) for item in node.values]))
        if isinstance(node, ast.BinOp) and isinstance(node.op, ast.Add):
            left = self.evaluate(node.left, env, module, conditions, routing)
            right = self.evaluate(node.right, env, module, conditions, routing)
            if type(left) is type(right) and isinstance(left, (str, int, float, list, tuple)):
                return left + right
        if isinstance(node, ast.JoinedStr):
            parts = []
            for part in node.values:
                if isinstance(part, ast.Constant):
                    parts.append(part.value)
                    continue
                value = self.evaluate(part.value, env, module, conditions, routing)
                if not isinstance(value, (str, int, float, bool, type(None))):
                    return unknown
                if part.conversion in (97, 114):
                    value = ascii(value) if part.conversion == 97 else repr(value)
                if part.conversion == 115:
                    value = str(value)
                spec = self.evaluate(part.format_spec, env, module, conditions, routing) if part.format_spec else ""
                if not isinstance(spec, str):
                    return unknown
                try:
                    parts.append(format(value, spec))
                except (ValueError, TypeError):
                    return unknown
            return "".join(parts)
        if isinstance(node, ast.Subscript):
            value = self.evaluate(node.value, env, module, conditions, routing)
            index = self.evaluate(node.slice, env, module, conditions, routing)
            if isinstance(value, (list, tuple, dict, str)) and isinstance(index, (int, str)):
                try:
                    return value[index]
                except (KeyError, IndexError, TypeError):
                    return unknown
        if isinstance(node, ast.UnaryOp) and isinstance(node.op, ast.Not):
            value = self.evaluate(node.operand, env, module, conditions, routing)
            if self.literal(value):
                return not value
        if isinstance(node, ast.Compare) and len(node.ops) == 1:
            left = self.evaluate(node.left, env, module, conditions, routing)
            right = self.evaluate(node.comparators[0], env, module, conditions, routing)
            if isinstance(node.ops[0], (ast.Is, ast.IsNot)) and (left is None or right is None):
                if not isinstance(left, Expr) and not isinstance(right, Expr):
                    return (left is right) == isinstance(node.ops[0], ast.Is)
            if self.literal(left) and self.literal(right):
                if isinstance(node.ops[0], ast.Eq):
                    return left == right
                if isinstance(node.ops[0], ast.NotEq):
                    return left != right
        if isinstance(node, ast.BoolOp):
            values = [self.evaluate(item, env, module, conditions, routing) for item in node.values]
            known = [bool(value) for value in values if self.literal(value)]
            if isinstance(node.op, ast.Or) and any(known):
                return True
            if isinstance(node.op, ast.And) and False in known:
                return False
            if len(known) == len(values):
                return any(known) if isinstance(node.op, ast.Or) else all(known)
        if isinstance(node, ast.Call):
            return self.call(node, env, module, conditions, routing)
        return unknown

    @staticmethod
    def literal(value: Any) -> bool:
        return isinstance(value, (str, int, float, bool, type(None)))

    def dependencies(self, node: ast.AST | None, env: dict, module: Module, scope: str, seen: set | None = None) -> list[dict]:
        if node is None:
            return []
        seen = set() if seen is None else seen
        key = (module.source.path, id(node))
        if key in seen:
            return []
        seen.add(key)
        result = []
        if isinstance(node, ast.Name):
            value = self.resolve(env.get(node.id), routing=True)
            if isinstance(value, Expr):
                result.extend(self.dependencies(value.node, value.env, value.module, scope, seen))
            elif isinstance(value, (list, tuple)):
                for item in value:
                    if isinstance(item, Expr):
                        result.extend(self.dependencies(item.node, item.env, item.module, scope, seen))
        if isinstance(node, ast.Constant) and isinstance(node.value, str):
            try:
                parsed = ast.parse(node.value, mode="eval").body
            except SyntaxError:
                return []
            if not isinstance(parsed, ast.Constant):
                ast.increment_lineno(parsed, node.lineno - 1)
                result.extend(self.dependencies(parsed, env, module, scope, seen))
        if isinstance(node, ast.Call):
            name = self.evaluate(node.func, env, module, [], routing=False)
            if isinstance(name, External) and name.name in {"fastapi.Depends", "fastapi.Security", "fastapi.params.Depends", "fastapi.params.Security"}:
                self.relevant.add(module.source.path)
                return [{**module.source.location(node), "scope": scope}]
        for child in ast.iter_child_nodes(node):
            result.extend(self.dependencies(child, env, module, scope, seen))
        return unique(result)

    def dependency_option(self, node: ast.AST | None, env: dict, module: Module, scope: str) -> list[dict]:
        result = self.dependencies(node, env, module, scope)
        if node is not None and not result and not (
            isinstance(node, ast.Constant) and node.value is None
            or isinstance(node, (ast.List, ast.Tuple)) and not node.elts
        ):
            result = [{**module.source.location(node), "scope": scope, "resolution": "opaque dependency expression"}]
        return result

    def function_dependencies(self, handler: Function) -> list[dict]:
        args = handler.node.args
        nodes = [*args.defaults, *(item for item in args.kw_defaults if item is not None)]
        nodes.extend(arg.annotation for arg in [*args.posonlyargs, *args.args, *args.kwonlyargs] if arg.annotation is not None)
        return unique([
            dep for node in nodes
            for dep in self.dependencies(node, handler.env, handler.module, "handler signature")
        ])

    def call(self, node: ast.Call, env: dict, module: Module, conditions: list[dict], routing: bool) -> Any:
        unknown = Expr(node, module, env.copy())
        if isinstance(node.func, ast.Attribute) and node.func.attr in ASSEMBLY:
            owner = self.evaluate(node.func.value, env, module, conditions, routing=True)
            if isinstance(owner, Router):
                if node.func.attr == "include_router":
                    self.include(owner, node, env, module, conditions)
                elif node.func.attr in ADD_ROUTES:
                    handler = self.evaluate(argument(node, 1, "endpoint"), env, module, conditions, routing=True)
                    self.register(owner, node, handler, env, module, conditions)
                else:
                    self.issue(module, node, "asgi-mount", "Mounted ASGI application is not expanded into FastAPI decorators; inspect this mount explicitly.")
                return None
            if node.func.attr != "mount":
                self.issue(module, node, "unresolved-receiver", "Routing registration receiver could not be resolved to a FastAPI/APIRouter object.")
            return unknown
        if isinstance(node.func, ast.Call) and isinstance(node.func.func, ast.Attribute) and node.func.func.attr in DECORATORS:
            owner = self.evaluate(node.func.func.value, env, module, conditions, routing=True)
            handler = self.evaluate(argument(node, 0, "endpoint"), env, module, conditions, routing=True)
            if isinstance(owner, Router):
                self.register(owner, node.func, handler, env, module, conditions)
                return handler
            self.issue(module, node, "applied-decorator", "Could not resolve applied route decorator receiver.")
            return unknown
        callee = self.evaluate(node.func, env, module, conditions, routing=False)
        if isinstance(callee, External) and callee.name in {
            "fastapi.FastAPI", "fastapi.APIRouter", "fastapi.applications.FastAPI", "fastapi.routing.APIRouter",
        }:
            self.relevant.add(module.source.path)
            kind = callee.name.rsplit(".", 1)[-1]
            prefix = self.evaluate(keyword(node, "prefix"), env, module, conditions, routing=True) if keyword(node, "prefix") else ""
            deps = self.dependency_option(keyword(node, "dependencies"), env, module, "application" if kind == "FastAPI" else "router")
            defaults = {
                "openapi_url": "/openapi.json", "docs_url": "/docs",
                "redoc_url": "/redoc", "swagger_ui_oauth2_redirect_url": "/docs/oauth2-redirect",
            }
            settings = {
                key: self.evaluate(keyword(node, key), env, module, conditions, routing=True)
                if keyword(node, key) is not None else default
                for key, default in defaults.items()
            }
            for item in node.keywords:
                if item.arg is None or item.arg == "routes":
                    self.issue(module, item.value, "constructor-routes", "Dynamic constructor keywords or an explicit routes list require separate route classification.")
            return Router(module, node, kind, prefix, deps, conditions.copy(), settings)
        if isinstance(callee, Function) and (routing or self.is_factory(callee)):
            if callee in self.call_stack:
                self.issue(module, node, "recursive-factory", "Recursive route factory is not expanded.")
                return unknown
            self.relevant.update((module.source.path, callee.module.source.path))
            self.call_stack.append(callee)
            local = callee.env.copy()
            args = [*callee.node.args.posonlyargs, *callee.node.args.args]
            defaults = dict(zip([arg.arg for arg in args[-len(callee.node.args.defaults):]] if callee.node.args.defaults else [], callee.node.args.defaults))
            defaults.update(zip([arg.arg for arg in callee.node.args.kwonlyargs], callee.node.args.kw_defaults))
            for arg in [*args, *callee.node.args.kwonlyargs]:
                local[arg.arg] = self.evaluate(defaults.get(arg.arg), callee.env, callee.module, conditions) if defaults.get(arg.arg) is not None else Expr(node, module, env.copy(), "unbound factory parameter")
            for arg, value in zip(args, node.args):
                local[arg.arg] = self.evaluate(value, env, module, conditions, routing=True)
            for item in node.keywords:
                if item.arg:
                    local[item.arg] = self.evaluate(item.value, env, module, conditions, routing=True)
                else:
                    self.issue(module, item.value, "factory-keywords", "Dynamic factory **kwargs are not bound.")
            try:
                returned, result = self.execute(callee.node.body, local, callee.module, conditions)
                return result if returned else unknown
            finally:
                self.call_stack.pop()
        return unknown

    @staticmethod
    def is_factory(function: Function) -> bool:
        for node in ast.walk(function.node):
            if isinstance(node, ast.Call):
                if isinstance(node.func, ast.Name) and node.func.id in {"FastAPI", "APIRouter"}:
                    return True
                if isinstance(node.func, ast.Attribute) and node.func.attr in ASSEMBLY:
                    return True
                if isinstance(node.func, ast.Attribute) and node.func.attr in DECORATORS and isinstance(node.func.value, ast.Name) and node.func.value.id in {"app", "router"}:
                    return True
        return False

    def bind(self, target: ast.AST, value: Any, env: dict, module: Module) -> None:
        if isinstance(target, ast.Name):
            previous = env.get(target.id)
            if isinstance(previous, Function) and previous is not value:
                self.overwrites.append({
                    "source": module.source.path, "name": target.id,
                    "previous_definition_line": previous.node.lineno,
                    "rebinding_line": target.lineno,
                    "note": "Previously registered function objects remain in the route table.",
                })
            env[target.id] = value
        elif isinstance(target, (ast.Tuple, ast.List)) and isinstance(value, (tuple, list)) and len(target.elts) == len(value):
            for child, item in zip(target.elts, value):
                self.bind(child, item, env, module)

    def execute(self, statements: list[ast.stmt], env: dict, module: Module, conditions: list[dict]) -> tuple[bool, Any]:
        for node in statements:
            if isinstance(node, (ast.Import, ast.ImportFrom)):
                for alias in node.names:
                    if isinstance(node, ast.Import):
                        name = alias.asname or alias.name.split(".")[0]
                        env[name] = Imported(alias.name if alias.asname else name, None, module, node)
                    else:
                        package = module.name.split(".") if module.source.path.endswith("/__init__.py") else module.name.split(".")[:-1]
                        base = ".".join(package[:len(package) - node.level + 1]) if node.level else ""
                        imported = ".".join(part for part in (base, node.module) if part)
                        if alias.name == "*":
                            self.issue(module, node, "star-import", "Star imports are not expanded; routing aliases may require explicit classification.")
                        else:
                            env[alias.asname or alias.name] = Imported(imported, alias.name, module, node)
            elif isinstance(node, (ast.Assign, ast.AnnAssign)):
                if node.value is not None:
                    value = self.evaluate(node.value, env, module, conditions)
                    for target in node.targets if isinstance(node, ast.Assign) else [node.target]:
                        self.bind(target, value, env, module)
            elif isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
                handler = Function(node, module, env, module.source.names[id(node)])
                for decorator in reversed(node.decorator_list):
                    if isinstance(decorator, ast.Call) and isinstance(decorator.func, ast.Attribute) and decorator.func.attr in DECORATORS:
                        owner = self.evaluate(decorator.func.value, env, module, conditions, routing=True)
                        if isinstance(owner, Router):
                            self.register(owner, decorator, handler, env, module, conditions)
                        else:
                            self.issue(module, decorator, "route-receiver", "Decorator receiver is not statically known to be a FastAPI/APIRouter object.")
                target = ast.Name(id=node.name)
                target.lineno = node.lineno
                self.bind(target, handler, env, module)
            elif isinstance(node, ast.ClassDef):
                local = env.copy()
                self.execute(node.body, local, module, conditions)
                env[node.name] = local
            elif isinstance(node, ast.Expr) and isinstance(node.value, ast.Call):
                self.evaluate(node.value, env, module, conditions)
            elif isinstance(node, ast.Return):
                return True, self.evaluate(node.value, env, module, conditions, routing=True)
            elif isinstance(node, ast.If):
                test = self.evaluate(node.test, env, module, conditions)
                if self.literal(test):
                    inactive = node.orelse if test else node.body
                    self.mark_inactive(inactive, module, f"Statically inactive branch of {expression(node.test)} at line {node.lineno}.")
                    returned, value = self.execute(node.body if test else node.orelse, env, module, conditions)
                    if returned:
                        return True, value
                else:
                    outcomes = []
                    for branch, truth in ((node.body, True), (node.orelse, False)):
                        local = env.copy()
                        guard = module.source.location(node.test, branch=truth)
                        result = self.execute(branch, local, module, conditions + [guard])
                        outcomes.append((local, result))
                    self.merge(env, [item[0] for item in outcomes], module, node.test)
                    if all(item[1][0] for item in outcomes):
                        left, right = outcomes[0][1][1], outcomes[1][1][1]
                        return True, left if left is right else Expr(node, module, env.copy(), "conditional factory returns different values")
            elif isinstance(node, (ast.Try, ast.TryStar)):
                variants = []
                local = env.copy()
                guard = module.source.location(node, branch="try succeeds")
                guard["expression"] = "try body completes without a handled exception"
                result = self.execute(node.body + node.orelse, local, module, conditions + [guard])
                variants.append(local)
                for handler in node.handlers:
                    local = env.copy()
                    guard = module.source.location(handler, branch="exception")
                    guard["expression"] = "except " + (expression(handler.type) or "BaseException")
                    self.execute(handler.body, local, module, conditions + [guard])
                    variants.append(local)
                self.merge(env, variants, module, node)
                returned, value = self.execute(node.finalbody, env, module, conditions)
                if returned:
                    return True, value
                if result[0] and not node.handlers:
                    return result
            elif isinstance(node, (ast.For, ast.AsyncFor)):
                values = self.evaluate(node.iter, env, module, conditions)
                if isinstance(values, (list, tuple)) and len(values) <= 100:
                    for value in values:
                        self.bind(node.target, value, env, module)
                        returned, result = self.execute(node.body, env, module, conditions)
                        if returned:
                            return True, result
                    self.execute(node.orelse, env, module, conditions)
                elif self.has_routing(node):
                    self.issue(module, node.iter, "dynamic-registration-loop", "Loop cardinality is unknown; body is represented once symbolically, not as a complete expansion.")
                    self.bind(node.target, Expr(node.iter, module, env.copy()), env, module)
                    self.execute(node.body, env, module, conditions + [module.source.location(node.iter, branch="unknown iteration")])
            elif isinstance(node, (ast.With, ast.AsyncWith)) and self.has_routing(node):
                self.execute(node.body, env, module, conditions + [module.source.location(node, branch="context entered")])
            elif isinstance(node, (ast.While, ast.Match)) and self.has_routing(node):
                self.issue(module, node, "unsupported-control-flow", "Routing under this control-flow construct is not expanded.")
        return False, None

    @staticmethod
    def has_routing(node: ast.AST) -> bool:
        return any(
            isinstance(child, ast.Call) and isinstance(child.func, ast.Attribute) and child.func.attr in ASSEMBLY | DECORATORS
            for child in ast.walk(node)
        )

    def mark_inactive(self, nodes: list[ast.stmt], module: Module, reason: str) -> None:
        ids = {id(child) for node in nodes for child in ast.walk(node)}
        for key, record in scan_declarations(module.source).items():
            if id(record["node"]) in ids:
                self.inactive[key] = reason

    @staticmethod
    def merge(env: dict, variants: list[dict], module: Module, node: ast.AST) -> None:
        for name in set().union(*(variant.keys() for variant in variants)):
            values = [variant.get(name) for variant in variants]
            first = values[0]
            if all(value is first or type(value) is type(first) and Analyzer.literal(value) and value == first for value in values):
                env[name] = first
            else:
                env[name] = Expr(node, module, env.copy(), f"conditional binding of {name}")

    def register(self, owner: Router, node: ast.Call, handler: Any, env: dict, module: Module, conditions: list[dict]) -> None:
        self.relevant.add(module.source.path)
        path_node = argument(node, 0, "path")
        path = self.evaluate(path_node, env, module, conditions, routing=True)
        path = owner.prefix + path if isinstance(owner.prefix, str) and isinstance(path, str) else None
        verb = node.func.attr
        is_websocket = "websocket" in verb
        methods_node = keyword(node, "methods")
        implicit_head = False
        if verb in HTTP_VERBS:
            methods, method_origin = [verb.upper()], "explicit decorator"
        elif is_websocket:
            methods, method_origin = ["WEBSOCKET"], "explicit websocket declaration (not an HTTP operation)"
        else:
            methods = self.evaluate(methods_node, env, module, conditions, routing=True) if methods_node is not None else ["GET"]
            method_origin = "explicit methods" if methods_node is not None else "default GET"
            if methods is None:
                methods, method_origin = ["GET"], "default GET"
            if not isinstance(methods, (list, tuple)) or not all(isinstance(method, str) for method in methods):
                self.issue(module, methods_node or node, "dynamic-methods", "HTTP methods cannot be enumerated statically.")
                methods = [None]
            else:
                methods = list(dict.fromkeys(method.upper() for method in methods))
                if verb in {"route", "add_route"} and "GET" in methods and "HEAD" not in methods:
                    methods.append("HEAD")
                    implicit_head = True
        all_conditions = unique(owner.conditions + conditions)
        deps = owner.dependencies + self.dependency_option(keyword(node, "dependencies"), env, module, "route")
        if isinstance(handler, Function):
            deps += self.function_dependencies(handler)
            source, name, definition_line = handler.module.source.path, handler.name, handler.node.lineno
            self.relevant.add(source)
        else:
            source, name, definition_line = module.source.path, None, None
            self.issue(module, node, "dynamic-handler", "Endpoint callable is not statically resolved to a source function.")
        if path is None:
            self.issue(module, path_node or node, "dynamic-path", "Route path or APIRouter prefix cannot be resolved to a string.")
        for guard in all_conditions:
            self.unresolved.append({
                "service": self.service, **guard, "kind": "conditional-registration",
                "classification": "conditional", "reason": "Source registration depends on this unexecuted condition.",
            })
        if any(item.arg is None for item in node.keywords):
            self.issue(module, node, "dynamic-route-keywords", "Route **kwargs can affect registration and require explicit review.")
        for method in methods:
            row = {
                "service": self.service, "method": method, "path": path,
                "source": source, "handler": name,
                "handler_id": source + "::" + name if name is not None else None,
                "line": node.lineno, "definition_line": definition_line,
                "declaration_source": module.source.path,
                "declaration_id": declaration_id(module.source.path, node),
                "declaration_expression": expression(node),
                "path_expression": expression(path_node),
                "method_origin": "Starlette Route implicit HEAD" if method == "HEAD" and implicit_head else method_origin,
                "protocol": "websocket" if is_websocket else "http",
                "mounts": [owner.evidence()], "conditions": all_conditions,
                "dependencies": list(dict.fromkeys(dep["expression"] for dep in deps)),
                "dependency_evidence": unique(deps),
                "registration": "unresolved" if path is None or method is None or name is None else "conditional" if all_conditions else "mounted",
                "include_in_schema": self.evaluate(keyword(node, "include_in_schema"), env, module, conditions) if keyword(node, "include_in_schema") is not None else True,
            }
            if not isinstance(row["include_in_schema"], bool):
                row["include_in_schema"] = None
            if keyword(node, "response_model") is not None:
                row["response_model_expression"] = expression(keyword(node, "response_model"))
            owner.records.append(row)
            self.declared_records.setdefault(row["declaration_id"], []).append(row)

    def include(self, owner: Router, node: ast.Call, env: dict, module: Module, conditions: list[dict]) -> None:
        self.relevant.add(module.source.path)
        child = self.evaluate(argument(node, 0, "router"), env, module, conditions, routing=True)
        if not isinstance(child, Router):
            self.issue(module, node, "unresolved-mount", "Included router/factory could not be resolved; its route set is unknown.")
            return
        prefix = self.evaluate(keyword(node, "prefix"), env, module, conditions, routing=True) if keyword(node, "prefix") is not None else ""
        deps = owner.dependencies + self.dependency_option(keyword(node, "dependencies"), env, module, "include_router")
        mount = {
            **module.source.location(node), "kind": "include_router",
            "prefix": prefix if isinstance(prefix, str) else None,
            "dependencies": [dep["expression"] for dep in deps],
        }
        if not isinstance(prefix, str):
            self.issue(module, keyword(node, "prefix") or node, "dynamic-mount-prefix", "Include prefix is not a static string; child routes retain unresolved final paths.")
        if any(item.arg is None for item in node.keywords):
            self.issue(module, node, "dynamic-mount-keywords", "Include **kwargs may alter prefixes/dependencies and need explicit review.")
        # FastAPI copies the child registry NOW; later additions are not mounted.
        for original in list(child.records):
            row = dict(original)
            row["path"] = owner.prefix + prefix + original["path"] if all(isinstance(value, str) for value in (owner.prefix, prefix, original["path"])) else None
            row["mounts"] = [owner.evidence(), mount, *original["mounts"]]
            row["conditions"] = unique(owner.conditions + conditions + original["conditions"])
            row["dependency_evidence"] = unique(deps + original["dependency_evidence"])
            row["dependencies"] = list(dict.fromkeys(dep["expression"] for dep in row["dependency_evidence"]))
            if keyword(node, "include_in_schema") is not None:
                included = self.evaluate(keyword(node, "include_in_schema"), env, module, conditions)
                row["include_in_schema"] = False if included is False or row["include_in_schema"] is False else True if included is True and row["include_in_schema"] is True else None
            row["registration"] = "unresolved" if row["path"] is None or original["registration"] == "unresolved" else "conditional" if row["conditions"] else "mounted"
            owner.records.append(row)
        for guard in conditions:
            self.unresolved.append({
                "service": self.service, **guard, "kind": "conditional-mount",
                "classification": "conditional", "reason": "Router inclusion depends on this unexecuted condition.",
            })

    def framework(self, app: Router) -> list[dict]:
        if app.kind != "FastAPI":
            return []
        settings = app.settings
        if settings["openapi_url"] is None or settings["openapi_url"] == "":
            return []
        result = []
        for option, label in (
            ("openapi_url", "openapi"),
            ("docs_url", "swagger_ui"),
            ("swagger_ui_oauth2_redirect_url", "swagger_oauth2_redirect"),
            ("redoc_url", "redoc"),
        ):
            if option == "swagger_ui_oauth2_redirect_url" and settings["docs_url"] in (None, ""):
                continue
            path = settings[option]
            if path is None or path == "":
                continue
            undecidable = not isinstance(path, str) or not isinstance(settings["openapi_url"], str)
            if option == "swagger_ui_oauth2_redirect_url" and not isinstance(settings["docs_url"], str):
                undecidable = True
            if undecidable:
                self.issue(app.module, keyword(app.node, option) or app.node, "framework-setting", "FastAPI generated route enablement/path is not a known string.")
            for method in ("GET", "HEAD"):
                result.append({
                    "service": self.service, "method": method,
                    "path": path if isinstance(path, str) else None,
                    "surface": label, "origin": "FastAPI-generated Starlette Route",
                    "source": app.module.source.path, "line": app.node.lineno,
                    "registration": "unresolved" if undecidable else "conditional" if app.conditions else "mounted",
                    "setting": option, "setting_expression": expression(keyword(app.node, option)) or "FastAPI default",
                    "method_origin": "framework GET" if method == "GET" else "Starlette Route implicit HEAD",
                    "include_in_schema": False, "dependencies": [],
                })
        return result

    @staticmethod
    def canonical(path: str) -> str:
        return PATH_PARAMETER.sub(lambda match: "{:" + (match.group(1) or "str") + "}", path)

    @classmethod
    def covers(cls, earlier: str, later: str) -> bool:
        if cls.canonical(earlier) == cls.canonical(later):
            return True
        if PATH_PARAMETER.search(later):
            return False
        parts = []
        start = 0
        for parameter in PATH_PARAMETER.finditer(earlier):
            converter = PATH_CONVERTERS.get(parameter.group(1) or "str")
            if converter is None:
                return False
            parts.extend((re.escape(earlier[start:parameter.start()]), converter))
            start = parameter.end()
        parts.append(re.escape(earlier[start:]))
        return re.fullmatch("".join(parts), later) is not None

    def finish(self) -> tuple[dict, list[dict], list[dict], list[dict]]:
        module = self.load(self.entry)
        if not isinstance(module, Module):
            raise ValueError(f"Missing entry module: {self.root}/{self.entry}")
        self.relevant.add(module.source.path)
        entry = self.resolve(module.env.get(self.binding), routing=True)
        if isinstance(entry, Expr):
            entry = self.evaluate(entry.node, entry.env, entry.module, [], routing=True)
        if not isinstance(entry, Router):
            self.issue(module, module.source.tree.body[-1], "entrypoint", "Entry binding is not a statically resolved application.")
            routes, framework = [], []
        else:
            routes, framework = [dict(row) for row in entry.records], self.framework(entry)
        covered = {row["declaration_id"] for row in routes}
        imported = set(self.modules)
        # Source-only modules are inspected, but never connected to the entry app.
        for path in sorted(self.scanned):
            source = self.sources.get(path)
            if scan_declarations(source):
                self.relevant.add(path)
        declarations = {
            key: (self.sources.get(path), record)
            for path in sorted(self.scanned)
            for key, record in scan_declarations(self.sources.get(path)).items()
        }
        excluded = []
        for key, (source, record) in declarations.items():
            if key in covered:
                continue
            node = record["node"]
            if key in self.inactive:
                reason = self.inactive[key]
            elif key in self.declared_records:
                reason = "Declaration was registered on an object not copied into the final entry app (unmounted/rebound router or registration after an include snapshot)."
            else:
                source_module = source.path[len(self.root) + 1:].removesuffix(".py").replace("/", ".").removesuffix(".__init__")
                reason = "Module is not reached by entry-point route assembly." if source_module not in imported else "Enclosing factory/function is not invoked by entry-point route assembly."
            excluded.append({
                "service": self.service, "declaration_id": key, "source": source.path,
                "line": node.lineno, "handler": record["handler"],
                "handler_id": source.path + "::" + record["handler"] if record["handler"] else None,
                "registration": "unmounted", "reason": reason,
                "expression": expression(node), "path_expression": expression(argument(node, 0, "path")),
            })
        if covered - declarations.keys() or covered & {row["declaration_id"] for row in excluded}:
            raise AssertionError("Declaration reconciliation failed: extra or overlapping classifications")
        if len(covered) + len(excluded) != len(declarations):
            raise AssertionError("Declaration reconciliation failed: missing classifications")
        earlier = []
        for row in framework:
            if row["registration"] == "mounted" and row["path"] is not None:
                earlier.append(row)
        for order, row in enumerate(routes, 1):
            row["registration_order"] = order
            row["route_id"] = f"{self.service}:{order}:{row['declaration_id']}:{row['method']}"
            if row["path"] is None or row["method"] is None:
                continue
            previous = next((
                candidate for candidate in earlier
                if candidate["method"] == row["method"] and self.covers(candidate["path"], row["path"])
            ), None)
            if previous is not None and row["registration"] != "unresolved":
                row["registration"] = "shadowed"
                row["shadowed_by"] = previous.get("route_id") or f"framework:{previous['surface']}:{previous['method']}"
                row["shadow_match"] = "identical-template" if self.canonical(previous["path"]) == self.canonical(row["path"]) else "parameter-before-literal"
                row["shadow_reason"] = "An earlier unconditional registration matches this method and complete path space. FastAPI/Starlette dispatch uses first match; handler type/query validation does not fall through to a later route."
            elif row["registration"] == "mounted":
                earlier.append(row)
            row["binding_overwritten"] = any(
                item["source"] == row["source"] and item["previous_definition_line"] == row["definition_line"]
                for item in self.overwrites
            )
        info = {
            "name": self.service, "source_root": self.root,
            "entrypoint": self.entry + ":" + self.binding,
            "assembly_source": entry.module.source.path if isinstance(entry, Router) else None,
            "assembly_line": entry.node.lineno if isinstance(entry, Router) else None,
            "scanned_python_files": len(self.scanned),
            "declaration_counts": dict(sorted(Counter(record["kind"] for _, record in declarations.values()).items())),
            "source_declarations": len(declarations),
            "reachable_declarations": len(covered), "excluded_declarations": len(excluded),
            "explicit_operations": len(routes),
            "registration_counts": dict(sorted(Counter(row["registration"] for row in routes).items())),
            "framework_operations": len(framework),
            "framework_path_count": len({row["path"] for row in framework}),
            "reconciliation": "source declarations = reachable declaration IDs + excluded declaration IDs; disjoint and exhaustive",
            "overwritten_function_bindings": [item for item in self.overwrites if any(row["source"] == item["source"] and row["definition_line"] == item["previous_definition_line"] for row in routes)],
        }
        return info, routes, framework, excluded


def build_inventory(root: Path, supplied: dict[str, str] | None = None, specs: tuple = SERVICE_SPECS) -> dict:
    sources = Sources(root, supplied)
    result = {
        "snapshot": SNAPSHOT, "kind": "static-source-not-live-openapi",
        "services": [], "source_files": [], "routes": [],
        "framework_routes": [], "unresolved": [], "excluded_declarations": [],
        "discovery": {
            "method": "standard-library AST, ordered symbol/alias and factory interpretation; no application imports",
            "hard_excluded_directories": sorted(HARD_EXCLUDED),
            "normally_excluded_directories": sorted(SOFT_EXCLUDED),
            "soft_exclusion_rule": "Scripts/migrations are parsed if referenced by route assembly, not scanned speculatively.",
            "handler_identity": "repo-relative source path + :: + Python lexical qualified function name; definition_line and declaration_id disambiguate redefinitions",
            "dependency_policy": "Source expressions from application/router/include/decorator/signature and Annotated aliases only; metadata is not an authentication or authorization guarantee.",
            "method_policy": "One entry per method. FastAPI API GET does not imply HEAD; explicit OPTIONS/HEAD remain endpoints. Starlette/framework GET implies HEAD. Websockets are marked WEBSOCKET, not HTTP. CORS middleware preflights and slash redirects are behavior, not additional explicit endpoints.",
            "limits": [
                "Assumes production imports, configuration validation and route assembly complete successfully; no application, cloud client, lifespan, worker, environment file or data is executed/read.",
                "Only literal/symbolic paths, aliases, local imports, simple factory calls and supported control flow are resolved. Observed undecidable routing expressions are classified in unresolved; arbitrary third-party code, eval, monkeypatches and runtime route mutation are not executed.",
                "Conditions record source possibilities, not live feature settings. Unmounted means not statically copied to the selected entry-point application.",
                "Shadowing covers identical templates (including renamed path parameters) and later literal paths matched by earlier built-in str/path/int/float/uuid converters. Partial overlaps, different parameterized templates, custom converters and conditional earlier routes require dispatch-level review.",
                "Framework surfaces use FastAPI defaults and Starlette GET/HEAD rules, not an installed-package import or live OpenAPI response.",
                "The independent syntax census proves declaration accounting within the source scope, not arbitrary Python execution completeness.",
            ],
        },
    }
    relevant = set()
    for spec in specs:
        analyzer = Analyzer(sources, *spec)
        info, routes, framework, excluded = analyzer.finish()
        result["services"].append(info)
        result["routes"].extend(routes)
        result["framework_routes"].extend(framework)
        result["excluded_declarations"].extend(excluded)
        result["unresolved"].extend(unique(analyzer.unresolved))
        relevant.update(analyzer.relevant)
    result["source_files"] = [
        {"path": path, "sha256": hashlib.sha256(sources.get(path).data).hexdigest()}
        for path in sorted(relevant)
    ]
    for row in result["routes"]:
        if row["registration"] in {"mounted", "conditional", "shadowed"} and not row["handler_id"]:
            raise AssertionError("Resolved route lacks a stable handler ID")
    if any(not item.get("classification") for item in result["unresolved"]):
        raise AssertionError("Unresolved item lacks explicit classification")
    return result


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--check", action="store_true", help="Compare with source without writing the inventory")
    parser.add_argument("--output", type=Path, help="Output file (default: docs\\workflows\\api-inventory.json)")
    args = parser.parse_args(argv)
    root = Path(__file__).resolve().parents[3]
    output = args.output or root / "docs" / "workflows" / "api-inventory.json"
    inventory = build_inventory(root)
    rendered = json.dumps(inventory, indent=2, ensure_ascii=False) + "\n"
    if args.check:
        if not output.is_file() or output.read_bytes() != rendered.encode("utf-8"):
            print(f"STALE: {output}; run inventory.py to regenerate.", file=sys.stderr)
            return 1
    else:
        output.parent.mkdir(parents=True, exist_ok=True)
        output.write_bytes(rendered.encode("utf-8"))
    for service in inventory["services"]:
        print(
            f"{service['name']}: {service['source_declarations']} declarations; "
            f"{service['explicit_operations']} explicit method registrations "
            f"{service['registration_counts']}; {service['excluded_declarations']} excluded; "
            f"{service['framework_operations']} framework method registrations"
        )
    print(f"{len(inventory['source_files'])} source hashes; {len(inventory['unresolved'])} classified unresolved items; {'check passed' if args.check else 'written'}.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
