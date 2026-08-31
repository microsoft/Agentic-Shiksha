from types import SimpleNamespace

import agent_tools.custom.add_tikz_diagram as tikz
import base_agents.general_agent as general_agent
from agent_tools.a2ui import block_to_a2ui
from utils.tikz_renderer import (
    TIKZ_PREAMBLE,
    _format_latex_error,
    _repair_misplaced_ampersands,
)


def _fake_client(content: str) -> SimpleNamespace:
    response = SimpleNamespace(
        choices=[SimpleNamespace(message=SimpleNamespace(content=content))]
    )
    completions = SimpleNamespace(create=lambda **_kwargs: response)
    return SimpleNamespace(chat=SimpleNamespace(completions=completions))


def _large_diagram() -> str:
    body = [r"\begin{tikzpicture}"]
    for index in range(60):
        body.append(rf"\node (node{index}) {{{index}}};")
        body.append(rf"\draw (node{index}) -- (node{index});")
    body.append(r"\end{tikzpicture}")
    return "\n".join(body)


def test_malformed_ampersand_escape_is_repaired_without_touching_valid_forms():
    source = "literal \\& | malformed \\\\& | linebreak then literal \\\\\\&"

    assert _repair_misplaced_ampersands(source) == (
        "literal \\& | malformed \\& | linebreak then literal \\\\\\&"
    )


def test_renderer_preamble_defines_model_subtitle_declaration():
    assert r"\providecommand{\subtitle}" in TIKZ_PREAMBLE


def test_tikz_tool_uses_tikz_image_payload_name():
    result = tikz._build_tikz_result({"title": "Missing description"})

    assert result["type"] == "tikz_image"


def test_undefined_command_detail_is_preserved_in_latex_feedback():
    log = "\n".join([
        "! Undefined control sequence.",
        r"<argument> \subtitle",
        "captions, prompts, OCR",
        "l.42 }};",
    ])
    source = "\n".join(["line"] * 50)

    error = _format_latex_error(log, source)

    assert r"<argument> \subtitle" in error
    assert "captions, prompts, OCR" in error


def test_failed_tikz_dispatch_cancels_placeholder(monkeypatch):
    failed_tool = SimpleNamespace(
        execute=lambda _args: {
            "error": True,
            "caption": "Diagram generation failed",
        },
        output=lambda _result, _args: "not used",
    )
    monkeypatch.setattr(general_agent, "add_tikz_diagram_tool", failed_tool)
    agent = SimpleNamespace(agent_name="course-test")

    result = general_agent.GeneralAgent._dispatch_tool_call(
        agent,
        "add_tikz_diagram",
        "{}",
        "call-1",
        "conversation-1",
        "user-1",
    )

    assert [event[0] for event in result["yield_events"]] == ["block_cancel"]
    assert "Nothing was shown to the student" in result["output"]


def test_successful_tikz_dispatch_uses_tikz_image_event(monkeypatch):
    successful_tool = SimpleNamespace(
        execute=lambda _args: {
            "type": "tikz_image",
            "title": "Pipeline",
            "imageData": "png-data",
        },
        output=lambda _result, _args: "shown",
    )
    monkeypatch.setattr(general_agent, "add_tikz_diagram_tool", successful_tool)
    agent = SimpleNamespace(agent_name="course-test")

    result = general_agent.GeneralAgent._dispatch_tool_call(
        agent,
        "add_tikz_diagram",
        "{}",
        "call-1",
        "conversation-1",
        "user-1",
    )

    assert [event[0] for event in result["yield_events"]] == ["tikz_image"]


def test_a2ui_catalog_translates_tikz_image_event():
    messages = block_to_a2ui(
        "tikz_image",
        {"title": "Pipeline", "imageData": "png-data"},
        "tikz-surface",
    )

    assert messages[-1]["createSurface"]["surfaceId"] == "tikz-surface"


def test_failed_edit_response_preserves_previous_code(monkeypatch):
    previous = _large_diagram()
    response = """<<<SEARCH>>>
\node (missing) {Not in the previous code};
<<<REPLACE>>>
\node (replacement) {Replacement};
<<<END>>>"""
    monkeypatch.setattr(tikz, "_get_inference_client", lambda: _fake_client(response))
    monkeypatch.setattr(tikz, "_track_usage", lambda _response: None)

    result = tikz._call_generator(
        description="A test diagram",
        title="Test",
        previous_code=previous,
        feedback="Fix the compile error on line 4",
    )

    assert result == previous
    assert "<<<SEARCH>>>" not in result


def test_destructive_full_rewrite_is_rejected(monkeypatch):
    previous = _large_diagram()
    response = r"""```tikz
\begin{tikzpicture}
\node (only) {Only one element remains};
\end{tikzpicture}
```"""
    monkeypatch.setattr(tikz, "_get_inference_client", lambda: _fake_client(response))
    monkeypatch.setattr(tikz, "_track_usage", lambda _response: None)

    result = tikz._call_generator(
        description="A test diagram",
        title="Test",
        previous_code=previous,
        feedback="Fix one arrow tip",
    )

    assert result == previous


def test_destructive_applied_edit_is_rejected(monkeypatch):
    previous = _large_diagram()
    response = f"""<<<SEARCH>>>
{previous}
<<<REPLACE>>>
\\begin{{tikzpicture}}
\\node (only) {{Only one element remains}};
\\end{{tikzpicture}}
<<<END>>>"""
    monkeypatch.setattr(tikz, "_get_inference_client", lambda: _fake_client(response))
    monkeypatch.setattr(tikz, "_track_usage", lambda _response: None)

    result = tikz._call_generator(
        description="A test diagram",
        title="Test",
        previous_code=previous,
        feedback="Fix one arrow tip",
    )

    assert result == previous


def test_replacement_line_numbers_are_removed():
    original = "\\begin{tikzpicture}\n\\node (a) {Old};\n\\end{tikzpicture}"
    response = """<<<SEARCH>>>
2 | \\node (a) {Old};
<<<REPLACE>>>
2 | \\node (a) {New};
<<<END>>>"""

    result = tikz._apply_edits(original, response)

    assert result == "\\begin{tikzpicture}\n\\node (a) {New};\n\\end{tikzpicture}"


def test_full_rewrite_with_preserved_structure_is_allowed():
    previous = _large_diagram()
    candidate = previous.replace("{0}", "{Input}", 1)

    assert tikz._retry_rewrite_problem(previous, candidate) is None


def test_optional_postprocessing_failure_returns_best_compiled_image(monkeypatch):
    verdict_calls = 0

    def discriminate(*_args, **_kwargs):
        nonlocal verdict_calls
        verdict_calls += 1
        if verdict_calls == 1:
            return {
                "average": 8.5,
                "all_pass": True,
                "parse_failed": False,
                "scores": {},
                "criteria_pass": {},
                "issues": [],
                "suggestions": [],
            }
        raise TimeoutError("final evaluation timed out")

    monkeypatch.setattr(tikz, "_call_generator", lambda **_kwargs: "initial-code")
    monkeypatch.setattr(tikz, "_compile_tikz", lambda _code: ("initial-image", None))
    monkeypatch.setattr(tikz, "_call_discriminator", discriminate)
    monkeypatch.setattr(tikz, "geometry_check_enabled", lambda: False)
    monkeypatch.setattr(
        tikz,
        "_call_polisher",
        lambda *_args, **_kwargs: (_ for _ in ()).throw(TimeoutError("polisher timed out")),
    )

    image, metadata = tikz.generate_tikz_diagram(
        "A test diagram",
        "Test",
        max_compile_retries=1,
        max_discriminator_rounds=1,
    )

    assert image == "initial-image"
    assert metadata["final_score"] == 8.5
    assert verdict_calls == 1


def test_final_evaluation_failure_reverts_to_best_scored_image(monkeypatch):
    verdict_calls = 0

    def discriminate(*_args, **_kwargs):
        nonlocal verdict_calls
        verdict_calls += 1
        if verdict_calls == 1:
            return {
                "average": 8.5,
                "all_pass": True,
                "parse_failed": False,
                "scores": {},
                "criteria_pass": {},
                "issues": [],
                "suggestions": [],
            }
        raise TimeoutError("final evaluation timed out")

    monkeypatch.setattr(tikz, "_call_generator", lambda **_kwargs: "initial-code")
    monkeypatch.setattr(
        tikz,
        "_compile_tikz",
        lambda code: ("polished-image" if code == "polished-code" else "initial-image", None),
    )
    monkeypatch.setattr(tikz, "_call_discriminator", discriminate)
    monkeypatch.setattr(tikz, "geometry_check_enabled", lambda: False)
    monkeypatch.setattr(tikz, "_call_polisher", lambda *_args, **_kwargs: "polished-code")

    image, metadata = tikz.generate_tikz_diagram(
        "A test diagram",
        "Test",
        max_compile_retries=1,
        max_discriminator_rounds=1,
    )

    assert image == "initial-image"
    assert metadata["final_score"] == 8.5
    assert verdict_calls == 2