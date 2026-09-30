"""Opt-in GRAPH_MEMORY_<FIELD> settings; no dotenv or implicit model deployment.

Compatibility names apply to constructors and attribute reads, not environment
variables or serialized output. The shared service field names are canonical.
"""

from functools import lru_cache
from typing import Annotated, ClassVar, Self

from pydantic import Field, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class MemorySettings(BaseSettings):
    model_config = SettingsConfigDict(
        env_prefix="GRAPH_MEMORY_", env_file=None, extra="ignore", frozen=True
    )

    _compatibility_names: ClassVar[dict[str, str]] = {
        "graph_container_name": "graph_container",
        "learner_container_name": "learner_container",
        "evidence_container_name": "evidence_container",
        "max_graph_hops": "max_hops",
        "max_retrieval_nodes": "max_nodes",
        "max_retrieval_edges": "max_edges",
        "max_retrieval_evidence": "max_evidence_items",
        "worker_lease_seconds": "lease_seconds",
        "worker_max_attempts": "max_attempts",
    }

    enabled: bool = False
    graph_container: Annotated[str, Field(min_length=1, max_length=255)] = "curriculum_graph_v1"
    learner_container: Annotated[str, Field(min_length=1, max_length=255)] = "learner_memory_v1"
    evidence_container: Annotated[
        str, Field(pattern=r"^[a-z0-9]+(?:-[a-z0-9]+)*$", min_length=3, max_length=63)
    ] = "learner-evidence-v1"
    observation_model: Annotated[str, Field(min_length=1, max_length=256, pattern=r"\S")] | None = None
    worker_enabled: bool = False
    worker_batch_size: Annotated[int, Field(ge=1, le=50)] = 10
    worker_concurrency: Annotated[int, Field(ge=1, le=16)] = 2
    worker_poll_seconds: Annotated[float, Field(ge=1, le=300)] = 5
    lease_seconds: Annotated[int, Field(ge=30, le=3600)] = 120
    max_attempts: Annotated[int, Field(ge=1, le=20)] = 5
    worker_retry_base_seconds: Annotated[int, Field(ge=1, le=300)] = 5
    query_page_size: Annotated[int, Field(ge=1, le=500)] = 100
    max_query_pages: Annotated[int, Field(ge=1, le=100)] = 10
    max_query_items: Annotated[int, Field(ge=1, le=10000)] = 1000
    max_query_ru: Annotated[float, Field(gt=0, le=1000)] = 100
    query_timeout_seconds: Annotated[float, Field(gt=0, le=120)] = 15
    max_graph_nodes: Annotated[int, Field(ge=1, le=5000)] = 2000
    max_graph_edges: Annotated[int, Field(ge=1, le=30000)] = 10000
    max_hops: Annotated[int, Field(ge=0, le=8)] = 4
    max_prerequisite_depth: Annotated[int, Field(ge=0, le=32)] = 8
    max_graph_bytes: Annotated[int, Field(ge=1024, le=1500000)] = 1000000
    max_snapshot_bytes: Annotated[int, Field(ge=1024, le=1500000)] = 700000
    max_snapshot_states: Annotated[int, Field(ge=1, le=5000)] = 1500
    max_event_bytes: Annotated[int, Field(ge=1024, le=500000)] = 200000
    max_artifact_bytes: Annotated[int, Field(ge=1024, le=64000000)] = 16000000
    max_replay_records: Annotated[int, Field(ge=1, le=20000)] = 5000
    max_evidence_per_reduction: Annotated[int, Field(ge=1, le=10000)] = 2500
    max_observations_per_reduction: Annotated[int, Field(ge=1, le=20000)] = 5000
    max_nodes: Annotated[int, Field(ge=1, le=200)] = 40
    max_edges: Annotated[int, Field(ge=1, le=500)] = 80
    max_evidence_items: Annotated[int, Field(ge=1, le=100)] = 20
    max_context_chars: Annotated[int, Field(ge=256, le=60000)] = 12000
    max_context_tokens: Annotated[int, Field(ge=128, le=15000)] = 3000
    max_cohort_students: Annotated[int, Field(ge=1, le=1000)] = 200
    validate_containers_on_startup: bool = True

    @model_validator(mode="before")
    @classmethod
    def compatibility_constructor_names(cls, values: object) -> object:
        if not isinstance(values, dict):
            return values
        values = dict(values)
        for alias, canonical in cls._compatibility_names.items():
            if alias in values:
                if canonical in values and values[canonical] != values[alias]:
                    raise ValueError(f"Conflicting settings names: {alias} and {canonical}")
                values[canonical] = values.pop(alias)
        return values

    @model_validator(mode="after")
    def consistent_limits(self) -> Self:
        if self.graph_container == self.learner_container:
            raise ValueError("Curriculum and learner containers must be distinct")
        if self.lease_seconds <= self.worker_poll_seconds:
            raise ValueError("Worker lease must exceed polling interval")
        if self.query_page_size > self.max_query_items:
            raise ValueError("Query page cannot exceed the total query item budget")
        if self.worker_enabled and not self.enabled:
            raise ValueError("The memory worker cannot be enabled while memory is disabled")
        if self.worker_enabled and not self.observation_model:
            raise ValueError("GRAPH_MEMORY_OBSERVATION_MODEL is required when the memory worker is enabled")
        return self

    @property
    def graph_container_name(self) -> str:
        return self.graph_container

    @property
    def learner_container_name(self) -> str:
        return self.learner_container

    @property
    def evidence_container_name(self) -> str:
        return self.evidence_container

    @property
    def max_graph_hops(self) -> int:
        return self.max_hops

    @property
    def max_retrieval_nodes(self) -> int:
        return self.max_nodes

    @property
    def max_retrieval_edges(self) -> int:
        return self.max_edges

    @property
    def max_retrieval_evidence(self) -> int:
        return self.max_evidence_items

    @property
    def worker_lease_seconds(self) -> int:
        return self.lease_seconds

    @property
    def worker_max_attempts(self) -> int:
        return self.max_attempts


@lru_cache(maxsize=1)
def get_memory_settings() -> MemorySettings:
    return MemorySettings()


get_settings = get_memory_settings
