import copy
import json
import sys
from types import SimpleNamespace
from unittest.mock import MagicMock, Mock

import pytest
from azure.core.exceptions import HttpResponseError, ResourceNotFoundError
from fastapi import FastAPI, Request
from fastapi.testclient import TestClient

from backend.dependencies import agent_access, auth
from backend.routers import curriculum_translation as routes
from backend.schemas.curriculum_translation import (
    CurriculumTranslationRequest,
    DEFAULT_TRANSLATION_INSTRUCTIONS,
    MAX_TRANSLATION_INSTRUCTIONS_LENGTH,
)
from utils.curriculum_translation import (
    TranslationInProgressError,
    get_or_create_translation,
    instructions_fingerprint,
    list_translations,
    load_translation,
    syllabus_source_hash,
    syllabus_strings,
    translation_blob_name,
    validate_translations,
)


@pytest.fixture
def curriculum():
    return {
        "course_name": "Example course",
        "syllabus": [{
            "module_id": "module-1",
            "title": "Introduction to Machine Learning",
            "topics": ["Supervised Learning"],
            "learning_objectives": ["Explain how a classifier works"],
        }],
        "all_threshold_concepts": ["Overfitting"],
        "Overfitting": {
            "definition": "A model learns training noise instead of general patterns.",
            "description": "Training performance can differ from performance on unseen data.",
            "related_modules": ["module-1"],
            "misconceptions": [
                "High training accuracy guarantees good predictions.",
                {"misconception": "More parameters always improve generalization."},
                {"description": "Test data can be reused for training."},
            ],
        },
    }


def test_translation_preserves_original_curriculum_and_progress_keys(curriculum):
    original = copy.deepcopy(curriculum)
    texts = syllabus_strings(curriculum)
    translated = validate_translations(texts, {"translations": [f"Mixed {text}" for text in texts]})
    assert curriculum == original
    assert "module-1" not in translated
    assert translated["Overfitting"] == "Mixed Overfitting"
    assert curriculum["all_threshold_concepts"] == ["Overfitting"]
    assert translated["Supervised Learning"] == "Mixed Supervised Learning"


def test_concepts_and_misconceptions_are_collected_without_private_progress(curriculum):
    curriculum["Overfitting"]["latest_summary"] = "Private learner progress"
    curriculum["Overfitting"]["misconception_notes"] = {"note": "Private learner note"}
    texts = syllabus_strings(curriculum)
    assert "Overfitting" in texts
    assert curriculum["Overfitting"]["definition"] in texts
    assert curriculum["Overfitting"]["description"] in texts
    assert "High training accuracy guarantees good predictions." in texts
    assert "More parameters always improve generalization." in texts
    assert "Test data can be reused for training." in texts
    assert "Private learner progress" not in texts
    assert "Private learner note" not in texts
    assert "module-1" not in texts


@pytest.mark.parametrize("field", ["definition", "description", "misconceptions"])
def test_concept_edits_change_translation_cache_key(curriculum, field):
    previous_hash = syllabus_source_hash(curriculum)
    curriculum["Overfitting"][field] = ["Updated misconception"] if field == "misconceptions" else "Updated explanation"
    assert syllabus_source_hash(curriculum) != previous_hash


def test_native_script_translation_does_not_reuse_legacy_cache(curriculum, monkeypatch):
    native_key = translation_blob_name("course-one", curriculum, "te", "mixed")
    monkeypatch.setattr("utils.curriculum_translation.TRANSLATION_VERSION", "syllabus-v2")
    assert translation_blob_name("course-one", curriculum, "te", "mixed") != native_key


def test_cache_is_scoped_to_course_language_style_and_source(curriculum):
    key = translation_blob_name("course-one", curriculum, "te", "mixed")
    assert key == translation_blob_name("course-one", copy.deepcopy(curriculum), "te", "mixed")
    assert key != translation_blob_name("course-two", curriculum, "te", "mixed")
    assert key != translation_blob_name("course-one", curriculum, "hi", "mixed")
    assert key != translation_blob_name("course-one", curriculum, "te", "pure")
    previous_hash = syllabus_source_hash(curriculum)
    curriculum["syllabus"][0]["topics"].append("Regression")
    assert syllabus_source_hash(curriculum) != previous_hash


@pytest.mark.parametrize("payload", [{"translations": []}, {"translations": [""]}, {"translations": ["one", "two"]}])
def test_incomplete_translations_are_rejected(payload):
    with pytest.raises(ValueError):
        validate_translations(["Explain a classifier"], payload)


def test_language_and_style_are_allowlisted():
    assert CurriculumTranslationRequest(language="te", source_hash="a" * 64).style == "mixed"
    assert CurriculumTranslationRequest(language="te", style="pure", source_hash="a" * 64).style == "pure"
    with pytest.raises(ValueError):
        CurriculumTranslationRequest(language="../../other")
    with pytest.raises(ValueError):
        CurriculumTranslationRequest(language="te", style="unsupported")


def test_instructions_have_a_default_and_normalize_line_endings():
    request = CurriculumTranslationRequest(language="te", source_hash="a" * 64)
    assert request.instructions == DEFAULT_TRANSLATION_INSTRUCTIONS
    assert instructions_fingerprint(request.instructions) == "default"
    custom = CurriculumTranslationRequest(language="te", source_hash="a" * 64, instructions="  Use simple words.\r\nKeep terminology.  ")
    assert custom.instructions == "Use simple words.\nKeep terminology."
    assert instructions_fingerprint(custom.instructions) == instructions_fingerprint("Use simple words.\r\nKeep terminology.")


@pytest.mark.parametrize("instructions", ["", " \r\n ", "x" * (MAX_TRANSLATION_INSTRUCTIONS_LENGTH + 1), None])
def test_invalid_instructions_are_rejected(instructions):
    with pytest.raises(ValueError):
        CurriculumTranslationRequest(language="te", source_hash="a" * 64, instructions=instructions)


@pytest.fixture
def storage():
    blobs = {}
    container = Mock()

    def download(name):
        if name not in blobs:
            error = ResourceNotFoundError("Missing blob")
            error.error_code = "BlobNotFound"
            raise error
        return SimpleNamespace(readall=lambda: blobs[name])

    def upload(name, content, **kwargs):
        blobs[name] = content

    container.download_blob.side_effect = download
    container.upload_blob.side_effect = upload
    container.list_blobs.side_effect = lambda name_starts_with: [
        SimpleNamespace(name=name) for name in blobs if name.startswith(name_starts_with)
    ]
    return container


def test_saved_translation_is_reused_without_model_call(curriculum, storage):
    translate = Mock(side_effect=lambda texts, language, style: {"translations": [f"{style} {text}" for text in texts]})
    first = get_or_create_translation(storage, "course-one", curriculum, "te", "mixed", translate)
    second = get_or_create_translation(storage, "course-one", curriculum, "te", "mixed", translate)
    assert first == second
    translate.assert_called_once()
    storage.upload_blob.assert_called_once()
    assert load_translation(storage, "course-one", curriculum, "te", "mixed") == first
    assert list_translations(storage, "course-one", curriculum)[0].style == "mixed"
    assert list_translations(storage, "course-two", curriculum) == []


def test_custom_instructions_are_cached_separately_and_private_to_the_user(curriculum, storage):
    translate = Mock(side_effect=lambda texts, language, style: {"translations": [f"{style} {text}" for text in texts]})
    default = get_or_create_translation(storage, "course-one", curriculum, "te", "mixed", translate)
    instructions = "Use short, everyday sentences."
    custom = get_or_create_translation(storage, "course-one", curriculum, "te", "mixed", translate, instructions, "user-one")
    repeated = get_or_create_translation(storage, "course-one", curriculum, "te", "mixed", translate, instructions + "\r\n", "user-one")
    assert repeated == custom
    assert custom.instructions_hash != default.instructions_hash
    assert translate.call_count == 2
    assert instructions not in custom.model_dump_json()
    assert len(list_translations(storage, "course-one", curriculum, "user-one")) == 2
    assert len(list_translations(storage, "course-one", curriculum, "user-two")) == 1
    assert load_translation(storage, "course-one", curriculum, "te", "mixed", custom.instructions_hash, "user-two") is None
    changed = get_or_create_translation(storage, "course-one", curriculum, "te", "mixed", translate, "Use a formal tone.", "user-one")
    assert changed.instructions_hash != custom.instructions_hash
    assert translate.call_count == 3


def test_legacy_default_translation_remains_readable(curriculum, storage):
    translate = Mock(side_effect=lambda texts, language, style: {"translations": texts})
    existing = get_or_create_translation(storage, "course-one", curriculum, "te", "mixed", translate)
    name = translation_blob_name("course-one", curriculum, "te", "mixed")
    storage.upload_blob(name, existing.model_dump_json(exclude={"instructions_hash"}).encode())
    assert load_translation(storage, "course-one", curriculum, "te", "mixed") == existing


def test_pure_translation_and_changed_syllabus_get_separate_cache_entries(curriculum, storage):
    translate = Mock(side_effect=lambda texts, language, style: {"translations": [f"{style} {text}" for text in texts]})
    get_or_create_translation(storage, "course-one", curriculum, "te", "mixed", translate)
    pure = get_or_create_translation(storage, "course-one", curriculum, "te", "pure", translate)
    assert pure.style == "pure"
    assert len(list_translations(storage, "course-one", curriculum)) == 2
    curriculum["syllabus"][0]["topics"].append("Regression")
    assert list_translations(storage, "course-one", curriculum) == []
    get_or_create_translation(storage, "course-one", curriculum, "te", "mixed", translate)
    assert translate.call_count == 3


def test_storage_error_does_not_trigger_generation(curriculum, storage):
    storage.download_blob.side_effect = HttpResponseError("Storage unavailable")
    translate = Mock()
    with pytest.raises(HttpResponseError):
        get_or_create_translation(storage, "course-one", curriculum, "te", "mixed", translate)
    translate.assert_not_called()


def test_partial_translation_is_not_saved(curriculum, storage):
    with pytest.raises(ValueError):
        get_or_create_translation(storage, "course-one", curriculum, "te", "mixed", Mock(return_value={"translations": ["incomplete"]}))
    storage.upload_blob.assert_not_called()
    storage.get_blob_client.return_value.acquire_lease.return_value.release.assert_called_once()


@pytest.fixture
def api(monkeypatch, curriculum, storage):
    profile = {"id": "example-user", "role": "student", "status": "active"}
    monkeypatch.setattr(auth, "verify_token", lambda token: {"sub": "example-user"} if token == "example-session" else None)
    monkeypatch.setattr(auth, "load_profile", lambda user_id: profile)
    monkeypatch.setattr(routes, "load_agent", lambda agent_name: {"id": agent_name, "studentIds": ["example-user"]})
    monkeypatch.setattr(agent_access, "student_assignment_ids", lambda user_id: [user_id])
    monkeypatch.setattr(routes, "load_curriculum", lambda agent_name: curriculum)
    monkeypatch.setattr(routes, "get_container", lambda: storage)
    translate = Mock(side_effect=lambda request, texts, language, style, instructions: {"translations": [f"{style} {text}" for text in texts]})
    monkeypatch.setattr(routes, "translate_texts", translate)
    app = FastAPI()
    app.include_router(routes.router)
    client = TestClient(app)
    client.cookies.set("session", "example-session")
    return client, profile, translate


def test_api_catalog_switch_and_repeated_create_reuse_saved_translation(api):
    client, _, translate = api
    url = "/api/agents/course-example/course-curriculum/translations"
    catalog = client.get(url)
    assert catalog.status_code == 200
    assert catalog.json()["translations"] == []
    assert catalog.json()["default_instructions"] == DEFAULT_TRANSLATION_INSTRUCTIONS
    assert catalog.json()["max_instructions_length"] == MAX_TRANSLATION_INSTRUCTIONS_LENGTH
    source_hash = catalog.json()["source_hash"]
    body = {"language": "te", "style": "mixed", "source_hash": source_hash}
    first = client.post(url, json=body)
    assert first.status_code == 200
    assert client.post(url, json=body).json() == first.json()
    assert client.get(f"{url}/te/mixed", params={"source_hash": source_hash}).json() == first.json()
    assert len(client.get(url).json()["translations"]) == 1
    translate.assert_called_once()


def test_api_custom_instructions_are_forwarded_cached_and_user_scoped(api, monkeypatch, curriculum):
    client, profile, translate = api
    url = "/api/agents/course-example/course-curriculum/translations"
    source_hash = syllabus_source_hash(curriculum)
    instructions = "Use short sentences for first-year learners."
    body = {"language": "te", "style": "mixed", "source_hash": source_hash, "instructions": instructions}
    response = client.post(url, json=body)
    assert response.status_code == 200
    translation = response.json()
    assert translation["instructions_hash"] == instructions_fingerprint(instructions)
    assert "instructions" not in translation
    assert translate.call_args.args[-1] == instructions
    assert client.post(url, json={**body, "instructions": "  " + instructions + "\r\n"}).json() == translation
    assert client.get(f"{url}/te/mixed", params={
        "source_hash": source_hash, "instructions_hash": translation["instructions_hash"],
    }).json() == translation
    translate.assert_called_once()
    assert len(client.get(url).json()["translations"]) == 1
    profile["id"] = "other-user"
    monkeypatch.setattr(auth, "verify_token", lambda token: {"sub": "other-user"})
    monkeypatch.setattr(routes, "load_agent", lambda agent_name: {"id": agent_name, "studentIds": ["example-user", "other-user"]})
    assert client.get(url).json()["translations"] == []
    assert client.get(f"{url}/te/mixed", params={
        "source_hash": source_hash, "instructions_hash": translation["instructions_hash"], "user_id": "example-user",
    }).status_code == 404


def test_api_rejects_invalid_instruction_variant_before_storage(api, storage):
    client, _, translate = api
    url = "/api/agents/course-example/course-curriculum/translations"
    assert client.get(f"{url}/te/mixed", params={
        "source_hash": "a" * 64, "instructions_hash": "../../other-user",
    }).status_code == 422
    assert client.post(url, json={
        "language": "te", "source_hash": "a" * 64, "instructions": "   ",
    }).status_code == 422
    storage.download_blob.assert_not_called()
    translate.assert_not_called()


@pytest.mark.parametrize("case", ["missing", "invalid", "inactive", "nonmember"])
def test_api_denies_unauthorized_access_before_storage(api, monkeypatch, storage, case):
    client, profile, translate = api
    if case == "missing":
        client.cookies.clear()
    elif case == "invalid":
        client.cookies.set("session", "invalid-session")
    elif case == "inactive":
        profile["status"] = "disabled"
    else:
        monkeypatch.setattr(routes, "load_agent", lambda agent_name: {"id": agent_name, "studentIds": ["another-user"]})
    url = "/api/agents/course-example/course-curriculum/translations"
    expected = 401 if case in {"missing", "invalid"} else 403
    assert client.get(url).status_code == expected
    assert client.post(url, json={"language": "te", "source_hash": "a" * 64}).status_code == expected
    storage.list_blobs.assert_not_called()
    storage.download_blob.assert_not_called()
    translate.assert_not_called()


def test_api_rejects_stale_syllabus_and_redacts_storage_failure(api, storage):
    client, _, translate = api
    url = "/api/agents/course-example/course-curriculum/translations"
    assert client.post(url, json={"language": "te", "source_hash": "a" * 64}).status_code == 409
    translate.assert_not_called()
    storage.list_blobs.side_effect = RuntimeError("private storage detail")
    response = client.get(url)
    assert response.status_code == 503
    assert "private storage detail" not in response.text


def test_existing_generation_lease_prevents_duplicate_model_call(curriculum, storage):
    conflict = HttpResponseError("Already generating")
    conflict.error_code = "LeaseAlreadyPresent"
    storage.get_blob_client.return_value.acquire_lease.side_effect = conflict
    translate = Mock()
    with pytest.raises(TranslationInProgressError):
        get_or_create_translation(storage, "course-one", curriculum, "te", "mixed", translate)
    translate.assert_not_called()
    storage.upload_blob.assert_not_called()


def test_save_failure_does_not_return_a_successful_translation(api, storage, curriculum):
    client, _, _ = api
    storage.upload_blob.side_effect = HttpResponseError("private storage error")
    response = client.post("/api/agents/course-example/course-curriculum/translations", json={
        "language": "te", "source_hash": syllabus_source_hash(curriculum),
    })
    assert response.status_code == 503
    assert "private storage error" not in response.text


def test_profile_failure_is_redacted(api, monkeypatch):
    client, _, translate = api
    monkeypatch.setattr(auth, "load_profile", Mock(side_effect=RuntimeError("private identity error")))
    response = client.get("/api/agents/course-example/course-curriculum/translations")
    assert response.status_code == 503
    assert "private identity error" not in response.text
    translate.assert_not_called()


@pytest.mark.parametrize("role", ["student", "teacher", "admin", "superadmin"])
def test_active_course_members_can_use_bearer_auth(api, monkeypatch, role):
    client, profile, _ = api
    client.cookies.clear()
    client.headers["Authorization"] = "Bearer example-session"
    profile["role"] = role
    monkeypatch.setattr(routes, "load_agent", lambda agent_name: {
        "id": agent_name, "studentIds": ["example-user"], "teacherIds": ["example-user"],
    })
    assert client.get("/api/agents/course-example/course-curriculum/translations").status_code == 200


def test_model_batches_preserve_order_and_use_requested_style():
    app = FastAPI()
    client = Mock()
    app.state.syllabus_translation_client = client
    app.state.syllabus_translation_model = "example-model"
    model = client.with_options.return_value.responses.create
    model.side_effect = lambda **kwargs: SimpleNamespace(
        status="completed", output_text=json.dumps({"translations": [
            f"Translated {text}" for text in json.loads(kwargs["input"])["texts"]
        ]}),
    )
    texts = [f"Topic {index}" for index in range(81)]
    instructions = "Use simple everyday phrasing."
    result = routes.translate_texts(Request({"type": "http", "app": app}), texts, "te", "mixed", instructions)
    assert result["translations"] == [f"Translated {text}" for text in texts]
    assert model.call_count == 2
    assert json.loads(model.call_args.kwargs["input"])["style"] == "mixed"
    assert json.loads(model.call_args.kwargs["input"])["language"] == "Telugu"
    for call in model.call_args_list:
        assert json.loads(call.kwargs["input"])["translation_instructions"] == instructions
        assert call.kwargs["instructions"] == routes.PROMPT
        assert instructions not in call.kwargs["instructions"]
    assert model.call_args.kwargs["store"] is False
    assert client.with_options.call_args.kwargs["max_retries"] == 0


@pytest.mark.parametrize("status, translations", [("completed", ["partial"]), ("incomplete", ["one", "two"])])
def test_model_batch_completeness_is_checked(status, translations):
    app = FastAPI()
    client = Mock()
    app.state.syllabus_translation_client = client
    app.state.syllabus_translation_model = "example-model"
    client.with_options.return_value.responses.create.return_value = SimpleNamespace(
        status=status, output_text=json.dumps({"translations": translations}),
    )
    with pytest.raises(ValueError):
        routes.translate_texts(Request({"type": "http", "app": app}), ["Topic one", "Topic two"], "hi", "pure")


def test_model_client_is_shared_for_lifespan_and_closed(monkeypatch):
    import azure.ai.projects

    project_factory = MagicMock()
    project = project_factory.return_value.__enter__.return_value
    model_client = project.get_openai_client.return_value.__enter__.return_value
    monkeypatch.setattr(azure.ai.projects, "AIProjectClient", project_factory)
    monkeypatch.setitem(sys.modules, "azure_services.config", SimpleNamespace(CHAT_MODEL="example-model", PROJECT_ENDPOINT="https://example.com"))
    monkeypatch.setitem(sys.modules, "common_azure_auth", SimpleNamespace(get_sync_credential=Mock(return_value=Mock())))
    app = FastAPI()
    app.include_router(routes.router)
    with TestClient(app):
        assert app.state.syllabus_translation_client is model_client
        assert app.state.syllabus_translation_model == "example-model"
        project_factory.assert_called_once()
    project.get_openai_client.return_value.__exit__.assert_called_once()
    project_factory.return_value.__exit__.assert_called_once()