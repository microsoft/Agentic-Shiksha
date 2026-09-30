"""Citation collection and per-response token accounting."""

import logging
from collections.abc import Iterator
from typing import Any, Dict, List, Optional

from harness.events import RuntimeEvent, json_event

logger = logging.getLogger("base_agents.general_agent")


class TurnTelemetry:
    def __init__(
        self,
        web_citations: list[dict[str, Any]],
        course_citations: list[dict[str, Any]],
        course_usage: dict[str, Any] | None,
    ) -> None:
        self.citations = [*web_citations, *course_citations]
        # Course passage identities intentionally do not share SDK annotation keys.
        self.citation_keys = {self._key(citation) for citation in web_citations}
        self.rounds = [course_usage] if course_usage else []
        self.input_tokens = course_usage["input_tokens"] if course_usage else 0
        self.output_tokens = course_usage["output_tokens"] if course_usage else 0

    @staticmethod
    def _key(citation: dict[str, Any]) -> str:
        return f"{citation.get('type')}:{citation.get('url') or citation.get('file_id')}"

    def _add_citation(self, citation: dict[str, Any]) -> None:
        key = self._key(citation)
        if key not in self.citation_keys:
            self.citation_keys.add(key)
            self.citations.append(citation)

    def annotation(self, event: Any) -> None:
        citation = _extract_citation_from_annotation_event(event)
        if citation:
            self._add_citation(citation)

    def completed(self, response: Any, tools: list[str], phase: str) -> None:
        if not response:
            return
        _log_response_completion(response, phase)
        usage = getattr(response, "usage", None)
        if usage:
            input_tokens = getattr(usage, "input_tokens", 0) or 0
            output_tokens = getattr(usage, "output_tokens", 0) or 0
            self.rounds.append({
                "round": len(self.rounds) + 1,
                "response_id": getattr(response, "id", None),
                "tools": list(tools),
                "input_tokens": input_tokens,
                "output_tokens": output_tokens,
            })
            self.input_tokens += input_tokens
            self.output_tokens += output_tokens
        for citation in _extract_citations_from_response(response):
            self._add_citation(citation)

    def events(self, conversation_id: str) -> Iterator[RuntimeEvent]:
        if self.citations:
            yield json_event("citations", self.citations, conversation_id)
        if self.rounds:
            yield json_event("usage", {
                "input_tokens": self.input_tokens,
                "output_tokens": self.output_tokens,
                "total_tokens": self.input_tokens + self.output_tokens,
                "rounds": len(self.rounds),
                "per_round": self.rounds,
            }, conversation_id)


def _log_response_completion(completed_response, phase: str) -> None:
    """Record why a round ended, so filtered turns are diagnosable after the fact.

    Azure reports content-filter action via status/incomplete_details and the
    per-output content_filter_results; none of it was previously logged, which is
    why refusals could only be observed second-hand in the transcript.
    """
    try:
        status = getattr(completed_response, "status", None)
        incomplete = getattr(completed_response, "incomplete_details", None)
        reason = getattr(incomplete, "reason", None) if incomplete else None

        filtered = []
        for item in (getattr(completed_response, "output", None) or []):
            results = getattr(item, "content_filter_results", None)
            if not results:
                continue
            as_dict = results if isinstance(results, dict) else getattr(results, "__dict__", {})
            for category, detail in (as_dict or {}).items():
                detail_dict = detail if isinstance(detail, dict) else getattr(detail, "__dict__", {})
                if (detail_dict or {}).get("filtered"):
                    filtered.append(f"{category}={detail_dict.get('severity', 'unknown')}")

        if filtered or reason:
            logger.error(
                "[content-filter] %s round ended status=%s reason=%s filtered=[%s]",
                phase, status, reason, ", ".join(filtered) or "none",
            )
        else:
            logger.debug("[content-filter] %s round ended status=%s", phase, status)
    except Exception as log_error:
        logger.debug(f"[content-filter] Could not inspect completion: {log_error}")


def _extract_citations_from_response(response) -> List[Dict[str, str]]:
    """
    Extract structured citation annotations from an OpenAI Responses API response object.
    
    Looks for AnnotationURLCitation, AnnotationFileCitation, and
    AnnotationContainerFileCitation in the response output items.
    
    Returns:
        List of citation dicts with 'title', 'url' or 'filename', 'type' keys.
    """
    citations = []
    seen = set()
    try:
        for output_item in (getattr(response, 'output', None) or []):
            # ResponseOutputMessage has .content list
            for content_part in (getattr(output_item, 'content', None) or []):
                for ann in (getattr(content_part, 'annotations', None) or []):
                    ann_type = getattr(ann, 'type', '')
                    if ann_type == 'url_citation':
                        url = getattr(ann, 'url', '')
                        title = getattr(ann, 'title', '') or url
                        key = f"url:{url}"
                        if key not in seen:
                            seen.add(key)
                            citations.append({"type": "url", "title": title, "url": url})
                    elif ann_type == 'file_citation':
                        file_id = getattr(ann, 'file_id', '')
                        filename = getattr(ann, 'filename', '') or file_id
                        key = f"file:{file_id}"
                        if key not in seen:
                            seen.add(key)
                            citations.append({"type": "file", "title": filename, "file_id": file_id, "filename": filename})
                    elif ann_type == 'container_file_citation':
                        file_id = getattr(ann, 'file_id', '')
                        filename = getattr(ann, 'filename', '') or file_id
                        container_id = getattr(ann, 'container_id', '')
                        key = f"container:{file_id}"
                        if key not in seen:
                            seen.add(key)
                            citations.append({"type": "file", "title": filename, "file_id": file_id, "filename": filename, "container_id": container_id})
    except Exception as e:
        logger.warning(f"Failed to extract citations from response: {e}")
    return citations


def _extract_citation_from_annotation_event(event) -> Optional[Dict[str, str]]:
    """
    Extract a single citation from a response.output_text.annotation.added streaming event.
    """
    try:
        ann = getattr(event, 'annotation', None)
        if not ann:
            return None
        ann_type = getattr(ann, 'type', '')
        if ann_type == 'url_citation':
            return {"type": "url", "title": getattr(ann, 'title', '') or getattr(ann, 'url', ''), "url": getattr(ann, 'url', '')}
        elif ann_type == 'file_citation':
            return {"type": "file", "title": getattr(ann, 'filename', '') or getattr(ann, 'file_id', ''), "file_id": getattr(ann, 'file_id', ''), "filename": getattr(ann, 'filename', '')}
        elif ann_type == 'container_file_citation':
            return {"type": "file", "title": getattr(ann, 'filename', '') or getattr(ann, 'file_id', ''), "file_id": getattr(ann, 'file_id', ''), "filename": getattr(ann, 'filename', ''), "container_id": getattr(ann, 'container_id', '')}
    except Exception as e:
        logger.debug(f"Failed to extract citation from annotation event: {e}")
    return None
