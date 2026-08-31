# learning_agent_manager.py
import os
import asyncio
from pathlib import Path
from typing import Optional, Callable, List

from azure.identity.aio import AzureCliCredential

# your existing helpers
from base_agents.agent_manager import BaseAgentManager

# 👇 adjust this import path if PdfToMarkdownPreprocessor lives somewhere else
from utils.markdown_converter import PdfToMarkdownPreprocessor


class LearningAgentManager(BaseAgentManager):
    """
    Minimal teaching agent:
      - create_or_get(...)       -> creates a new agent with instructions
      - ask(...)                 -> chat with a specific agent_id
    NOTE:
      This version does NOT read or write any local agents.json.
      All operations are done directly against the Azure AI project.
    """

    def __init__(
        self,
        *,
        project_endpoint: str,
        config_path: str,
        credential_factory: Optional[Callable[[], AzureCliCredential]] = None,
    ):
        super().__init__(
            project_endpoint=project_endpoint,
            config_path=config_path,
            credential_factory=credential_factory,
        )
        self._project_endpoint = project_endpoint

    async def create_or_get(
        self,
        *,
        agent_name: str,
        instructions: str,
        model_deployment: str,
        save_to_config: bool = False,
        include_web_search: bool = False,
        include_custom_search: bool = False,
        custom_search_instance_name: Optional[str] = None,
        course_urls: Optional[List[str]] = None,
        search_index_name: Optional[str] = None,
        search_index_filter: Optional[str] = None,
        search_connection_id: Optional[str] = None,
        memory_store_name: Optional[str] = None,
        memory_scope: str = "{{$userId}}",
        memory_update_delay: int = 300,
    ) -> str:
        """
        Create a new agent with the given name + instructions.

        Local agents.json is NOT consulted and NOT updated.
        If you call this multiple times with the same name, you will
        get multiple distinct agents in Azure AI.
        
        Args:
            include_web_search: If True, adds BingGroundingTool for general web search (default: False)
            include_custom_search: If True, adds BingCustomSearchTool for domain-specific search (default: False)
            custom_search_instance_name: The Bing Custom Search configuration instance name.
                                         Teachers create this in Azure Portal with allowed domains/URLs.
            course_urls: Teacher-curated URLs for focused web search.
            memory_store_name: Name of memory store to attach for persistent per-user memory.
            memory_scope: Scope for memory isolation (default: auto user-based).
            memory_update_delay: Seconds of inactivity before storing memories.
        """
        agent_id = await self.create_agent(
            agent_name=agent_name,
            instructions=instructions,
            model_deployment=model_deployment,
            # 👇 IMPORTANT: do not persist to local config / agents.json
            save_to_config=save_to_config,
            include_web_search=include_web_search,
            include_custom_search=include_custom_search,
            custom_search_instance_name=custom_search_instance_name,
            course_urls=course_urls,
            search_index_name=search_index_name,
            search_index_filter=search_index_filter,
            search_connection_id=search_connection_id,
            memory_store_name=memory_store_name,
            memory_scope=memory_scope,
            memory_update_delay=memory_update_delay,
            # and do not try to "return existing" based on local config
            # (BaseAgentManager can ignore if_exists or you can set it
            #  to a value that forces creation; adjust to your implementation)
        )
        return agent_id


# ---- standalone test (only runs when executed directly) ----
if __name__ == "__main__":
    POPPLER_PATH = os.getenv(
        "POPPLER_PATH",
        r"C:\poppler\Library\bin",
    )

    # By default, consider only markdown for the vector store
    FILE_PATTERNS = ["*.md"]  # we will use the markdown outputs as docs

    cred_factory = lambda: AzureCliCredential(process_timeout=60)

    async def main():
        # ----- 1A. Run PDF → markdown preprocessing for Discrete Structures -----
        if RAW_PDF_DIR.exists():
            print(f"Preprocessing PDFs from: {RAW_PDF_DIR}")
            pre = PdfToMarkdownPreprocessor(
                azure_endpoint=AZURE_OPENAI_ENDPOINT,
                azure_api_version=AZURE_OPENAI_API_VERSION,
                deployment_name=AZURE_OPENAI_DEPLOYMENT,
                poppler_path=POPPLER_PATH,
            )

            MARKDOWN_DIR.mkdir(parents=True, exist_ok=True)

            success, errors = pre.extract_folder(
                folder_path=str(RAW_PDF_DIR),
                pattern="*.pdf",
                write_to_files=True,
                output_dir=str(MARKDOWN_DIR),
            )

            print("✅ PDF→Markdown preprocessing complete.")
            for pdf, md in success.items():
                print(f" - {pdf} -> {md}")

            if errors:
                print("\n⚠️ Errors during preprocessing:")
                for pdf, err in errors.items():
                    print(f" - {pdf}: {err}")
        else:
            print(
                f"RAW_PDF_DIR does not exist: {RAW_PDF_DIR}\n"
                "Skipping preprocessing; make sure markdown docs exist if you expect File Search."
            )

        # ----- 2. Use the markdown folder as docs_dir for the learning agent -----
        DOCS_DIR = MARKDOWN_DIR  # this is what will go into the vector store

        # 2.1 Load prompts from prompt_store using PromptManager
        pm = PromptManager()  # no args per your design
        instructions = pm.get(
            "exam_companion", name="instruction", user="Swapnik", mode="practice"
        )
        system_prompt = pm.get("exam_companion", name="system")
        xyz_prompt = pm.get("exam_companion", name="xyz", user="Swapnik")

        print("instruction:", instructions)
        print("system:", system_prompt)
        print("xyz:", xyz_prompt)

        # Compose final instruction text the agent will use.
        final_instructions = "\n\n".join(
            part for part in [system_prompt, instructions, xyz_prompt] if part
        )

        mgr = LearningAgentManager(
            project_endpoint=PROJECT_ENDPOINT,
            config_path=CONFIG_PATH,
            credential_factory=cred_factory,
        )

        # 2.2 Create a new agent with the composed prompt (no agents.json usage)
        agent_id = await mgr.create_or_get(
            agent_name=AGENT_NAME,
            instructions=final_instructions,
            model_deployment=MODEL_DEPLOYMENT,
        )
        print("Agent ID:", agent_id)

        # 2.3 Ask something
        answer = await mgr.ask(
            agent_id=agent_id,
            question=(
                "Design a 2-week learning plan for Discrete Structures focusing on "
                "core threshold concepts, using the uploaded textbooks as references."
            ),
        )
        print("\n=== Answer ===\n", answer)

    asyncio.run(main())