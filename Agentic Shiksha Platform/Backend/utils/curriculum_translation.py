import hashlib
import json
import logging
import threading
from collections.abc import Callable, Iterator
from contextlib import contextmanager
from datetime import datetime, timezone

from azure.core.exceptions import HttpResponseError, ResourceExistsError, ResourceNotFoundError
from azure.storage.blob import ContainerClient, ContentSettings

from backend.schemas.curriculum_translation import (
    CurriculumTranslation,
    CurriculumTranslationSummary,
    DEFAULT_TRANSLATION_INSTRUCTIONS,
    TranslationBatch,
    TranslationLanguage,
    TranslationStyle,
    normalize_translation_instructions,
)


TRANSLATION_VERSION = "curriculum-native-v3"
logger = logging.getLogger(__name__)
LANGUAGES = {
    "te": "Telugu", "hi": "Hindi", "ta": "Tamil", "kn": "Kannada",
    "ml": "Malayalam", "mr": "Marathi", "bn": "Bengali", "gu": "Gujarati",
    "pa": "Punjabi", "ur": "Urdu", "or": "Odia", "as": "Assamese",
}


def syllabus_strings(curriculum: dict) -> list[str]:
    texts = []
    for field in ("course_name", "course_level"):
        value = curriculum.get(field)
        if isinstance(value, str) and value.strip():
            texts.append(value)
    for module in curriculum.get("syllabus", []):
        for field in ("title", "module", "name", "description"):
            value = module.get(field)
            if isinstance(value, str) and value.strip():
                texts.append(value)
        for field in ("topics", "learning_objectives", "prerequisites"):
            for value in module.get(field, []):
                if isinstance(value, dict):
                    value = value.get("title") or value.get("name")
                if isinstance(value, str) and value.strip():
                    texts.append(value)
    for concept_name in curriculum.get("all_threshold_concepts", []):
        if not isinstance(concept_name, str) or not concept_name.strip():
            continue
        texts.append(concept_name)
        concept = curriculum.get(concept_name)
        if not isinstance(concept, dict):
            continue
        for field in ("definition", "description"):
            value = concept.get(field)
            if isinstance(value, str) and value.strip():
                texts.append(value)
        for misconception in concept.get("misconceptions", []) or []:
            if isinstance(misconception, str) and misconception.strip():
                texts.append(misconception)
            elif isinstance(misconception, dict):
                for field in ("misconception", "description"):
                    value = misconception.get(field)
                    if isinstance(value, str) and value.strip():
                        texts.append(value)
    return list(dict.fromkeys(texts))


def syllabus_source_hash(curriculum: dict) -> str:
    source = json.dumps([TRANSLATION_VERSION, syllabus_strings(curriculum)], ensure_ascii=False)
    return hashlib.sha256(source.encode("utf-8")).hexdigest()


def instructions_fingerprint(instructions: str) -> str:
    normalized = normalize_translation_instructions(instructions)
    if normalized == DEFAULT_TRANSLATION_INSTRUCTIONS:
        return "default"
    return hashlib.sha256(("instructions-v1\n" + normalized).encode("utf-8")).hexdigest()


def translation_blob_name(
    agent_name: str, curriculum: dict, language: str, style: str,
    instructions_hash: str = "default", user_id: str | None = None,
) -> str:
    agent_key = hashlib.sha256(agent_name.encode("utf-8")).hexdigest()
    if instructions_hash != "default":
        if not user_id:
            raise ValueError("Custom translations require a user scope")
        user_key = hashlib.sha256(user_id.encode("utf-8")).hexdigest()
        return f"custom-translations/{agent_key}/{user_key}/{syllabus_source_hash(curriculum)}/{language}-{style}-{instructions_hash}.json"
    return f"translations/{agent_key}/{syllabus_source_hash(curriculum)}/{language}-{style}.json"


def validate_translations(texts: list[str], payload: object) -> dict[str, str]:
    batch = TranslationBatch.model_validate(payload)
    if len(batch.translations) != len(texts) or any(not value.strip() for value in batch.translations):
        raise ValueError("Translation must include every source string exactly once")
    return dict(zip(texts, batch.translations))


class TranslationInProgressError(Exception):
    pass


def load_translation(
    container: ContainerClient, agent_name: str, curriculum: dict,
    language: TranslationLanguage, style: TranslationStyle,
    instructions_hash: str = "default", user_id: str | None = None,
) -> CurriculumTranslation | None:
    blob_name = translation_blob_name(agent_name, curriculum, language, style, instructions_hash, user_id)
    try:
        payload = container.download_blob(blob_name).readall()
    except ResourceNotFoundError as error:
        if error.error_code != "BlobNotFound":
            raise
        return None
    translation = CurriculumTranslation.model_validate_json(payload)
    if (
        translation.source_hash != syllabus_source_hash(curriculum)
        or translation.language != language
        or translation.style != style
        or translation.instructions_hash != instructions_hash
        or set(translation.translations) != set(syllabus_strings(curriculum))
        or any(not text.strip() for text in translation.translations.values())
    ):
        raise ValueError("Saved translation does not match the syllabus")
    return translation


def list_translations(
    container: ContainerClient, agent_name: str, curriculum: dict,
    user_id: str | None = None,
) -> list[CurriculumTranslationSummary]:
    prefix = translation_blob_name(agent_name, curriculum, "te", "mixed").rsplit("/", 1)[0] + "/"
    prefixes = [prefix]
    if user_id:
        custom_prefix = translation_blob_name(agent_name, curriculum, "te", "mixed", "0" * 64, user_id).rsplit("/", 1)[0] + "/"
        prefixes.append(custom_prefix)
    summaries = []
    for prefix in prefixes:
        for blob in container.list_blobs(name_starts_with=prefix):
            if not blob.name.endswith(".json"):
                continue
            translation = CurriculumTranslation.model_validate_json(container.download_blob(blob.name).readall())
            if translation.source_hash != syllabus_source_hash(curriculum):
                raise ValueError("Saved translation has an outdated syllabus")
            expected_name = translation_blob_name(
                agent_name, curriculum, translation.language, translation.style,
                translation.instructions_hash, user_id,
            )
            if blob.name != expected_name:
                raise ValueError("Saved translation does not match its scope")
            summaries.append(CurriculumTranslationSummary.model_validate(
                translation.model_dump(exclude={"translations"})
            ))
    return sorted(summaries, key=lambda item: (item.language, item.style, item.created_at))


@contextmanager
def _translation_lease(container: ContainerClient, blob_name: str) -> Iterator[threading.Event]:
    lock_blob = container.get_blob_client(blob_name + ".lock")
    try:
        lock_blob.upload_blob(b"", overwrite=False)
    except ResourceExistsError:
        pass
    try:
        lease = lock_blob.acquire_lease(lease_duration=60)
    except HttpResponseError as error:
        if error.error_code in ("LeaseAlreadyPresent", "LeaseIsBreakingAndCannotBeAcquired"):
            raise TranslationInProgressError from error
        raise
    stop = threading.Event()
    lost = threading.Event()

    def renew() -> None:
        while not stop.wait(20):
            try:
                lease.renew()
            except HttpResponseError:
                lost.set()
                return

    heartbeat = threading.Thread(target=renew, daemon=True)
    heartbeat.start()
    try:
        yield lost
    finally:
        stop.set()
        heartbeat.join()
        try:
            lease.release()
        except HttpResponseError:
            logger.warning("Unable to release translation lease; it will expire")


def get_or_create_translation(
    container: ContainerClient, agent_name: str, curriculum: dict,
    language: TranslationLanguage, style: TranslationStyle,
    translate: Callable[[list[str], TranslationLanguage, TranslationStyle], object],
    instructions: str = DEFAULT_TRANSLATION_INSTRUCTIONS, user_id: str | None = None,
) -> CurriculumTranslation:
    instructions_hash = instructions_fingerprint(instructions)
    existing = load_translation(container, agent_name, curriculum, language, style, instructions_hash, user_id)
    if existing is not None:
        return existing
    blob_name = translation_blob_name(agent_name, curriculum, language, style, instructions_hash, user_id)
    with _translation_lease(container, blob_name) as lost:
        existing = load_translation(container, agent_name, curriculum, language, style, instructions_hash, user_id)
        if existing is not None:
            return existing
        texts = syllabus_strings(curriculum)
        translated = validate_translations(texts, translate(texts, language, style))
        if lost.is_set():
            raise TranslationInProgressError
        result = CurriculumTranslation(
            language=language, style=style, source_hash=syllabus_source_hash(curriculum),
            translations=translated, created_at=datetime.now(timezone.utc), instructions_hash=instructions_hash,
        )
        container.upload_blob(
            blob_name, result.model_dump_json().encode("utf-8"), overwrite=False,
            content_settings=ContentSettings(content_type="application/json; charset=utf-8"),
        )
        return result
