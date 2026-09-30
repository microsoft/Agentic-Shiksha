from admin_backend.core.settings import get_research_settings, get_runtime_settings


def research_response(prompt: str) -> str:
    from azure.ai.projects import AIProjectClient
    from azure.identity import DefaultAzureCredential

    settings = get_research_settings()
    with DefaultAzureCredential(
        process_timeout=get_runtime_settings().azure_cli_timeout,
    ) as credential:
        with AIProjectClient(
            endpoint=settings.research_project_endpoint,
            credential=credential,
        ) as client:
            openai_client = client.get_openai_client()
            conversation = openai_client.conversations.create()
            response = openai_client.responses.create(
                conversation=conversation.id,
                input=prompt,
                extra_body={
                    "agent_reference": {
                        "name": settings.research_agent_name,
                        "type": "agent_reference",
                    },
                },
            )
            return response.output_text or ""
