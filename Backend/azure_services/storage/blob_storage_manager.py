# file: blob_storage_manager.py
# Purpose: Upload files to Azure Blob Storage and create vector stores from blob URIs for agents
# NOTE: Uses Azure Document Intelligence for PDF text extraction (NOT GPT-4o based OCR)
#
# Async Workflow:
# 1. Files are uploaded to a local temp folder
# 2. Each file is processed asynchronously using Azure Document Intelligence
# 3. Processed files (extracted text) are uploaded to Azure Blob Storage
# 4. Both local unprocessed and processed files are removed after upload

import os
import asyncio
import aiofiles
import tempfile
import shutil
import uuid
from pathlib import Path
from typing import List, Optional, Any, Dict, Union, Callable
from datetime import datetime, timedelta
from io import BytesIO
import logging
from concurrent.futures import ThreadPoolExecutor

from azure.identity import DefaultAzureCredential
from azure.identity.aio import DefaultAzureCredential as AsyncDefaultAzureCredential

# Centralized auth (prefer singleton to avoid Windows file locking)
try:
    from common_azure_auth import get_sync_credential as _get_sync_cred, get_async_credential as _get_async_cred
    _HAS_CENTRAL_AUTH = True
except ImportError:
    _HAS_CENTRAL_AUTH = False

def _default_sync_credential():
    return _get_sync_cred() if _HAS_CENTRAL_AUTH else DefaultAzureCredential()

def _default_async_credential():
    return _get_async_cred() if _HAS_CENTRAL_AUTH else AsyncDefaultAzureCredential()
from azure.storage.blob import BlobServiceClient, ContainerClient, BlobClient, generate_blob_sas, BlobSasPermissions
from azure.storage.blob.aio import BlobServiceClient as AsyncBlobServiceClient
from azure.ai.agents import AgentsClient
from azure.ai.agents.models import (
    VectorStoreDataSource,
    VectorStoreDataSourceAssetType,
    AzureAISearchTool,
    AzureAISearchQueryType,
)

# NOTE: FileSearchTool has been deprecated in favor of Azure AI Search
# The following import is removed:
# from azure.ai.agents.models import FileSearchTool

logger = logging.getLogger(__name__)


# ================== Async File Processor ==================

class AsyncFileProcessor:
    """
    Asynchronous file processor that:
    1. Stores files in a local temp folder
    2. Processes files using Azure Document Intelligence
    3. Uploads processed files to Azure Blob Storage
    4. Cleans up local files after processing
    
    Usage:
        processor = AsyncFileProcessor(
            storage_account_name="mystorageaccount",
            document_intelligence_endpoint="https://...",
            project_endpoint="https://...",
        )
        
        # Process uploaded files
        results = await processor.process_uploaded_files(
            files=[("file1.pdf", pdf_bytes1), ("file2.pdf", pdf_bytes2)],
            user_id="user123",
            agent_id="agent456",
        )
    """
    
    def __init__(
        self,
        storage_account_name: str,
        document_intelligence_endpoint: str,
        container_name: str = "agent-files",
        project_endpoint: Optional[str] = None,
        credential: Optional[Any] = None,
        temp_dir: Optional[str] = None,
        max_concurrent_processing: int = 5,
        output_format: str = "markdown",
    ):
        """
        Initialize the async file processor.
        
        Args:
            storage_account_name: Azure Storage Account name
            document_intelligence_endpoint: Document Intelligence endpoint
            container_name: Blob container name
            project_endpoint: Azure AI Project endpoint (for vector stores)
            credential: Azure credential (defaults to DefaultAzureCredential)
            temp_dir: Custom temp directory (defaults to system temp)
            max_concurrent_processing: Max concurrent Document Intelligence requests
            output_format: "text" or "markdown" for extracted content
        """
        self.storage_account_name = storage_account_name
        self.document_intelligence_endpoint = document_intelligence_endpoint
        self.container_name = container_name
        self.project_endpoint = project_endpoint
        self.credential = credential or _default_sync_credential()
        self.temp_dir = temp_dir or tempfile.gettempdir()
        self.max_concurrent_processing = max_concurrent_processing
        self.output_format = output_format
        
        # Semaphore to limit concurrent Document Intelligence calls
        self._semaphore = asyncio.Semaphore(max_concurrent_processing)
        
        # Thread pool for blocking operations
        self._executor = ThreadPoolExecutor(max_workers=max_concurrent_processing)
        
        # Lazy-loaded clients
        self._blob_client: Optional[AsyncBlobServiceClient] = None
        self._di_client = None
        self._agents_client = None
    
    async def _get_async_blob_client(self) -> AsyncBlobServiceClient:
        """Get or create async blob service client."""
        if self._blob_client is None:
            async_credential = _default_async_credential()
            account_url = f"https://{self.storage_account_name}.blob.core.windows.net"
            self._blob_client = AsyncBlobServiceClient(
                account_url=account_url,
                credential=async_credential
            )
            # Ensure container exists
            await self._ensure_container_exists()
        return self._blob_client
    
    async def _ensure_container_exists(self):
        """Create container if it doesn't exist."""
        try:
            container_client = self._blob_client.get_container_client(self.container_name)
            if not await container_client.exists():
                await container_client.create_container()
                logger.info(f"Created container: {self.container_name}")
        except Exception as e:
            logger.warning(f"Could not check/create container: {e}")
    
    def _get_di_client(self):
        """Get or create Document Intelligence client (sync)."""
        if self._di_client is None:
            try:
                from azure.ai.documentintelligence import DocumentIntelligenceClient
                self._di_client = DocumentIntelligenceClient(
                    endpoint=self.document_intelligence_endpoint,
                    credential=self.credential
                )
            except ImportError:
                raise ImportError(
                    "azure-ai-documentintelligence not installed. "
                    "Run: pip install azure-ai-documentintelligence"
                )
        return self._di_client
    
    def _get_agents_client(self) -> AgentsClient:
        """Get or create agents client."""
        if self._agents_client is None:
            if not self.project_endpoint:
                raise ValueError("project_endpoint required for agents operations")
            self._agents_client = AgentsClient(
                endpoint=self.project_endpoint,
                credential=self.credential
            )
        return self._agents_client
    
    def _create_session_folder(self) -> Path:
        """Create a unique session folder for file processing."""
        session_id = str(uuid.uuid4())[:8]
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        folder_name = f"ekalaiva_processing_{timestamp}_{session_id}"
        folder_path = Path(self.temp_dir) / folder_name
        folder_path.mkdir(parents=True, exist_ok=True)
        logger.info(f"Created session folder: {folder_path}")
        return folder_path
    
    async def _save_file_to_temp(
        self,
        file_bytes: bytes,
        filename: str,
        session_folder: Path,
    ) -> Path:
        """Save uploaded file to temp folder asynchronously."""
        file_path = session_folder / filename
        async with aiofiles.open(file_path, "wb") as f:
            await f.write(file_bytes)
        logger.debug(f"Saved to temp: {filename}")
        return file_path
    
    def _needs_ocr_processing(self, file_path: Path) -> bool:
        """Check if file needs OCR processing with Document Intelligence."""
        # Only PDFs and images need Document Intelligence OCR
        ocr_extensions = {".pdf", ".png", ".jpg", ".jpeg", ".tiff", ".bmp", ".gif"}
        return file_path.suffix.lower() in ocr_extensions
    
    async def _process_file_with_di(
        self,
        file_path: Path,
        session_folder: Path,
    ) -> Path:
        """
        Process a file - OCR for PDFs/images, direct upload for text files.
        
        PDFs and images → Document Intelligence OCR → extracted text
        Text files (.txt, .md, .docx) → Upload directly without conversion
        """
        suffix = file_path.suffix.lower()
        
        # Text files that don't need OCR - just return the original file
        if not self._needs_ocr_processing(file_path):
            logger.info(f"Skipping OCR for text file: {file_path.name}")
            return file_path
        
        # PDFs and images need Document Intelligence OCR
        async with self._semaphore:
            loop = asyncio.get_event_loop()
            
            def extract_text():
                client = self._get_di_client()
                with open(file_path, "rb") as f:
                    file_bytes = f.read()
                
                # Determine content type for OCR
                if suffix == ".pdf":
                    content_type = "application/pdf"
                elif suffix in [".png", ".jpg", ".jpeg"]:
                    content_type = f"image/{suffix[1:]}"
                elif suffix == ".tiff":
                    content_type = "image/tiff"
                elif suffix == ".bmp":
                    content_type = "image/bmp"
                elif suffix == ".gif":
                    content_type = "image/gif"
                else:
                    content_type = "application/pdf"
                
                poller = client.begin_analyze_document(
                    model_id="prebuilt-layout",
                    body=BytesIO(file_bytes),
                    content_type=content_type
                )
                result = poller.result()
                
                # Convert result to text/markdown
                if self.output_format == "markdown":
                    text = self._result_to_markdown(result)
                else:
                    text = self._result_to_text(result)
                
                return text
            
            try:
                extracted_text = await loop.run_in_executor(
                    self._executor, extract_text
                )
            except Exception as e:
                logger.error(f"Document Intelligence error for {file_path.name}: {e}")
                raise  # Re-raise since PDFs/images must be OCR'd
            
            # Save extracted text to session folder
            ext = ".md" if self.output_format == "markdown" else ".txt"
            extracted_filename = file_path.stem + "_extracted" + ext
            extracted_path = session_folder / extracted_filename
            
            async with aiofiles.open(extracted_path, "w", encoding="utf-8") as f:
                await f.write(extracted_text)
            
            logger.info(f"OCR processed: {file_path.name} -> {extracted_filename}")
            return extracted_path
    
    def _result_to_text(self, result) -> str:
        """Convert Document Intelligence result to plain text."""
        pages_text = []
        for page in result.pages:
            if hasattr(page, 'lines') and page.lines:
                lines = [line.content for line in page.lines]
                pages_text.append("\n".join(lines))
        return "\n\n".join(pages_text)
    
    def _result_to_markdown(self, result) -> str:
        """Convert Document Intelligence result to markdown format."""
        markdown_parts = []
        
        for page_num, page in enumerate(result.pages, 1):
            markdown_parts.append(f"## Page {page_num}\n")
            
            if hasattr(result, 'paragraphs') and result.paragraphs:
                page_paragraphs = [
                    p for p in result.paragraphs 
                    if any(br.page_number == page_num for br in getattr(p, 'bounding_regions', []))
                ]
                for para in page_paragraphs:
                    role = getattr(para, 'role', None)
                    content = para.content
                    
                    if role == 'title':
                        markdown_parts.append(f"# {content}\n")
                    elif role == 'sectionHeading':
                        markdown_parts.append(f"### {content}\n")
                    else:
                        markdown_parts.append(f"{content}\n")
            else:
                if hasattr(page, 'lines') and page.lines:
                    lines = [line.content for line in page.lines]
                    markdown_parts.append("\n".join(lines))
            
            markdown_parts.append("\n---\n")
        
        # Add tables if present
        if hasattr(result, 'tables') and result.tables:
            markdown_parts.append("\n## Tables\n")
            for table_num, table in enumerate(result.tables, 1):
                markdown_parts.append(f"\n### Table {table_num}\n")
                markdown_parts.append(self._table_to_markdown(table))
        
        return "\n".join(markdown_parts)
    
    def _table_to_markdown(self, table) -> str:
        """Convert table to markdown format."""
        if not table.cells:
            return ""
        
        max_row = max(cell.row_index for cell in table.cells)
        max_col = max(cell.column_index for cell in table.cells)
        
        grid = [["" for _ in range(max_col + 1)] for _ in range(max_row + 1)]
        
        for cell in table.cells:
            grid[cell.row_index][cell.column_index] = cell.content.replace("\n", " ")
        
        lines = []
        for row_num, row in enumerate(grid):
            lines.append("| " + " | ".join(row) + " |")
            if row_num == 0:
                lines.append("| " + " | ".join(["---"] * len(row)) + " |")
        
        return "\n".join(lines)
    
    async def _upload_to_blob(
        self,
        file_path: Path,
        user_id: Optional[str] = None,
        agent_id: Optional[str] = None,
        metadata: Optional[Dict[str, str]] = None,
    ) -> str:
        """Upload a file to blob storage asynchronously."""
        blob_client = await self._get_async_blob_client()
        
        # Construct blob name
        parts = []
        if agent_id:
            parts.append(f"agents/{agent_id}")
        if user_id:
            parts.append(f"users/{user_id}")
        parts.append(file_path.name)
        blob_name = "/".join(parts)
        
        # Prepare metadata
        blob_metadata = metadata or {}
        blob_metadata.update({
            "original_filename": file_path.name,
            "uploaded_at": datetime.utcnow().isoformat(),
            "processed": "true",
        })
        if user_id:
            blob_metadata["user_id"] = user_id
        if agent_id:
            blob_metadata["agent_id"] = agent_id
        
        # Read file content
        async with aiofiles.open(file_path, "rb") as f:
            file_content = await f.read()
        
        # Upload to blob
        container_client = blob_client.get_container_client(self.container_name)
        blob = container_client.get_blob_client(blob_name)
        
        await blob.upload_blob(
            file_content,
            overwrite=True,
            metadata=blob_metadata,
        )
        
        blob_url = f"https://{self.storage_account_name}.blob.core.windows.net/{self.container_name}/{blob_name}"
        logger.info(f"Uploaded to blob: {blob_name}")
        return blob_url
    
    async def _cleanup_session_folder(self, session_folder: Path):
        """Remove the session folder and all its contents."""
        try:
            loop = asyncio.get_event_loop()
            await loop.run_in_executor(
                None, 
                lambda: shutil.rmtree(session_folder, ignore_errors=True)
            )
            logger.info(f"Cleaned up session folder: {session_folder}")
        except Exception as e:
            logger.warning(f"Error cleaning up session folder: {e}")
    
    async def process_single_file(
        self,
        filename: str,
        file_bytes: bytes,
        user_id: Optional[str] = None,
        agent_id: Optional[str] = None,
        cleanup: bool = True,
    ) -> Dict[str, Any]:
        """
        Process a single file: save, extract text, upload to blob, cleanup.
        
        Args:
            filename: Original filename
            file_bytes: File content as bytes
            user_id: Optional user ID
            agent_id: Optional agent ID
            cleanup: Whether to cleanup local files after processing
            
        Returns:
            Result dictionary with blob_uri and metadata
        """
        session_folder = self._create_session_folder()
        
        try:
            # Step 1: Save to temp folder
            original_path = await self._save_file_to_temp(
                file_bytes, filename, session_folder
            )
            
            # Step 2: Process with Document Intelligence
            processed_path = await self._process_file_with_di(
                original_path, session_folder
            )
            
            # Step 3: Upload processed file to blob storage
            blob_uri = await self._upload_to_blob(
                processed_path,
                user_id=user_id,
                agent_id=agent_id,
            )
            
            # Read extracted text for response
            async with aiofiles.open(processed_path, "r", encoding="utf-8") as f:
                extracted_text = await f.read()
            
            return {
                "success": True,
                "filename": filename,
                "processed_filename": processed_path.name,
                "blob_uri": blob_uri,
                "extracted_text_preview": extracted_text[:500] + "..." if len(extracted_text) > 500 else extracted_text,
                "text_length": len(extracted_text),
            }
            
        except Exception as e:
            logger.error(f"Error processing {filename}: {e}")
            return {
                "success": False,
                "filename": filename,
                "error": str(e),
            }
        finally:
            # Step 4: Cleanup local files
            if cleanup:
                await self._cleanup_session_folder(session_folder)
    
    async def process_uploaded_files(
        self,
        files: List[tuple],  # List of (filename, bytes)
        user_id: Optional[str] = None,
        agent_id: Optional[str] = None,
        progress_callback: Optional[Callable[[int, int, str], None]] = None,
    ) -> Dict[str, Any]:
        """
        Process multiple uploaded files asynchronously.
        
        Args:
            files: List of (filename, file_bytes) tuples
            user_id: Optional user ID
            agent_id: Optional agent ID
            progress_callback: Optional callback(current, total, filename)
            
        Returns:
            Dictionary with results and blob URIs
        """
        session_folder = self._create_session_folder()
        results = []
        blob_uris = []
        
        try:
            # Save all files to temp folder first
            saved_files = []
            for filename, file_bytes in files:
                path = await self._save_file_to_temp(file_bytes, filename, session_folder)
                saved_files.append((filename, path))
            
            # Process all files concurrently
            tasks = []
            for i, (filename, file_path) in enumerate(saved_files):
                task = self._process_and_upload_file(
                    original_filename=filename,
                    file_path=file_path,
                    session_folder=session_folder,
                    user_id=user_id,
                    agent_id=agent_id,
                )
                tasks.append(task)
            
            # Wait for all processing to complete
            processing_results = await asyncio.gather(*tasks, return_exceptions=True)
            
            for i, result in enumerate(processing_results):
                filename = files[i][0]
                if isinstance(result, Exception):
                    results.append({
                        "success": False,
                        "filename": filename,
                        "error": str(result),
                    })
                else:
                    results.append(result)
                    if result.get("success") and result.get("blob_uri"):
                        blob_uris.append(result["blob_uri"])
                
                if progress_callback:
                    progress_callback(i + 1, len(files), filename)
            
            return {
                "success": True,
                "total_files": len(files),
                "successful_files": len(blob_uris),
                "failed_files": len(files) - len(blob_uris),
                "blob_uris": blob_uris,
                "results": results,
                "session_folder": str(session_folder),
            }
            
        finally:
            # Cleanup session folder
            await self._cleanup_session_folder(session_folder)
    
    async def _process_and_upload_file(
        self,
        original_filename: str,
        file_path: Path,
        session_folder: Path,
        user_id: Optional[str] = None,
        agent_id: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Process a single file and upload to blob storage."""
        try:
            # Process with Document Intelligence (only for PDFs/images)
            processed_path = await self._process_file_with_di(file_path, session_folder)
            
            # Upload to blob storage
            blob_uri = await self._upload_to_blob(
                processed_path,
                user_id=user_id,
                agent_id=agent_id,
            )
            
            # Get file stats (handle both text and binary files)
            was_ocr_processed = self._needs_ocr_processing(file_path)
            try:
                async with aiofiles.open(processed_path, "r", encoding="utf-8") as f:
                    content = await f.read()
                text_length = len(content)
            except UnicodeDecodeError:
                # Binary file, just get size
                text_length = processed_path.stat().st_size
            
            return {
                "success": True,
                "filename": original_filename,
                "processed_filename": processed_path.name,
                "blob_uri": blob_uri,
                "text_length": text_length,
                "ocr_processed": was_ocr_processed,
            }
        except Exception as e:
            logger.error(f"Error processing {original_filename}: {e}")
            return {
                "success": False,
                "filename": original_filename,
                "error": str(e),
            }
    
    async def create_vector_store_from_results(
        self,
        blob_uris: List[str],
        vector_store_name: str = "processed_documents_vectorstore",
    ) -> Any:
        """Create a vector store from processed blob URIs."""
        agents_client = self._get_agents_client()
        
        data_sources = [
            VectorStoreDataSource(
                asset_identifier=uri,
                asset_type=VectorStoreDataSourceAssetType.URI_ASSET
            )
            for uri in blob_uris
        ]
        
        vector_store = agents_client.vector_stores.create_and_poll(
            data_sources=data_sources,
            name=vector_store_name
        )
        
        logger.info(f"Created vector store: {vector_store.id} with {len(blob_uris)} documents")
        return vector_store
    
    async def process_and_create_agent(
        self,
        files: List[tuple],
        agent_name: str,
        agent_instructions: str,
        model: str = "gpt-4o",
        user_id: Optional[str] = None,
        index_name: Optional[str] = None,
        search_connection_id: Optional[str] = None,
    ) -> Dict[str, Any]:
        """
        Complete workflow: process files, upload to blob, create vector store, create agent.
        
        NOTE: FileSearchTool is deprecated. This now creates agent with Azure AI Search.
        
        Args:
            files: List of (filename, file_bytes) tuples
            agent_name: Name for the agent
            agent_instructions: System instructions
            model: Model to use
            user_id: Optional user ID
            index_name: Azure AI Search index name (required for retrieval)
            search_connection_id: Azure AI Search connection ID
            
        Returns:
            Dictionary with agent, vector_store, and processing results
        """
        # Process all files
        process_result = await self.process_uploaded_files(
            files=files,
            user_id=user_id,
            agent_id=agent_name,
        )
        
        if not process_result.get("blob_uris"):
            raise ValueError("No files were successfully processed")
        
        # Create vector store (for storage, not FileSearchTool)
        vector_store = await self.create_vector_store_from_results(
            blob_uris=process_result["blob_uris"],
            vector_store_name=f"{agent_name}_vectorstore",
        )
        
        # Create agent - NOTE: FileSearchTool is deprecated
        # Agent is created without file search tool - use Azure AI Search attachment separately
        agents_client = self._get_agents_client()
        
        tools = []
        tool_resources = {}
        
        # Use Azure AI Search if index_name is provided
        if index_name and search_connection_id:
            ai_search = AzureAISearchTool(
                index_connection_id=search_connection_id,
                index_name=index_name,
                query_type=AzureAISearchQueryType.VECTOR_SEMANTIC_HYBRID,
            )
            tools = list(ai_search.definitions)
            tool_resources = ai_search.resources
            logger.info(f"Using Azure AI Search index: {index_name}")
        else:
            logger.warning("No Azure AI Search index provided - agent created without retrieval tool")
        
        agent = agents_client.create_agent(
            model=model,
            name=agent_name,
            instructions=agent_instructions,
            tools=tools,
            tool_resources=tool_resources,
        )
        
        logger.info(f"Created agent: {agent.id}")
        
        return {
            "agent": agent,
            "agent_id": agent.id,
            "vector_store": vector_store,
            "vector_store_id": vector_store.id,
            "processing_results": process_result,
            "files_processed": process_result["total_files"],
            "files_successful": process_result["successful_files"],
        }
    
    async def close(self):
        """Close async clients and cleanup resources."""
        if self._blob_client:
            await self._blob_client.close()
        self._executor.shutdown(wait=False)
        logger.info("AsyncFileProcessor closed")


class BlobStorageManager:
    """
    Manager for uploading files to Azure Blob Storage and creating vector stores
    that can be attached to Azure AI Agents.
    
    This supports two workflows:
    1. Upload local files to Blob Storage
    2. Create vector stores from Blob URIs for agent retrieval
    
    NOTE: FileSearchTool is deprecated. Use Azure AI Search for retrieval instead.
    
    Usage:
        manager = BlobStorageManager(
            storage_account_name="mystorageaccount",
            container_name="agent-files",
            project_endpoint="https://...",
        )
        
        # Upload files and create vector store
        blob_uris = manager.upload_files_from_directory("./documents")
        vector_store = manager.create_vector_store_from_blobs(blob_uris)
        
        # Attach to agent using Azure AI Search
        ai_search = AzureAISearchTool(
            index_connection_id=connection_id,
            index_name=index_name,
            query_type=AzureAISearchQueryType.VECTOR_SEMANTIC_HYBRID,
        )
        agent = agents_client.create_agent(
            model="gpt-4o",
            tools=ai_search.definitions,
            tool_resources=ai_search.resources,
        )
    """

    def __init__(
        self,
        storage_account_name: str,
        container_name: str = "agent-files",
        project_endpoint: Optional[str] = None,
        credential: Optional[Any] = None,
        connection_string: Optional[str] = None,
    ):
        """
        Initialize the Blob Storage Manager.
        
        Args:
            storage_account_name: Name of the Azure Storage Account
            container_name: Name of the blob container (will be created if doesn't exist)
            project_endpoint: Azure AI Project endpoint (for creating vector stores)
            credential: Azure credential (defaults to DefaultAzureCredential)
            connection_string: Optional connection string (alternative to credential auth)
        """
        self.storage_account_name = storage_account_name
        self.container_name = container_name
        self.project_endpoint = project_endpoint
        
        # Initialize credential
        self.credential = credential or _default_sync_credential()
        
        # Initialize Blob Service Client
        if connection_string:
            self.blob_service_client = BlobServiceClient.from_connection_string(connection_string)
        else:
            account_url = f"https://{storage_account_name}.blob.core.windows.net"
            self.blob_service_client = BlobServiceClient(
                account_url=account_url,
                credential=self.credential
            )
        
        # Initialize Agents Client if project endpoint provided
        self.agents_client = None
        if project_endpoint:
            self.agents_client = AgentsClient(
                endpoint=project_endpoint,
                credential=self.credential
            )
        
        # Ensure container exists
        self._ensure_container_exists()

    def _ensure_container_exists(self):
        """Create the container if it doesn't exist."""
        try:
            container_client = self.blob_service_client.get_container_client(self.container_name)
            if not container_client.exists():
                container_client.create_container()
                print(f"Created container: {self.container_name}")
        except Exception as e:
            print(f"Note: Could not check/create container: {e}")

    # ================== File Upload Methods ==================

    def upload_file(
        self,
        file_path: Union[str, Path],
        blob_name: Optional[str] = None,
        user_id: Optional[str] = None,
        agent_id: Optional[str] = None,
        overwrite: bool = True,
        metadata: Optional[Dict[str, str]] = None,
    ) -> str:
        """
        Upload a single file to Blob Storage.
        
        Args:
            file_path: Local path to the file
            blob_name: Optional custom blob name (defaults to filename)
            user_id: Optional user ID for organizing files
            agent_id: Optional agent ID for organizing files
            overwrite: Whether to overwrite existing blobs
            metadata: Optional metadata to attach to the blob
            
        Returns:
            Blob URI
        """
        file_path = Path(file_path)
        if not file_path.exists():
            raise FileNotFoundError(f"File not found: {file_path}")
        
        # Construct blob name with optional organization
        if blob_name is None:
            parts = []
            if agent_id:
                parts.append(f"agents/{agent_id}")
            if user_id:
                parts.append(f"users/{user_id}")
            parts.append(file_path.name)
            blob_name = "/".join(parts)
        
        # Prepare metadata
        blob_metadata = metadata or {}
        blob_metadata.update({
            "original_filename": file_path.name,
            "uploaded_at": datetime.utcnow().isoformat(),
        })
        if user_id:
            blob_metadata["user_id"] = user_id
        if agent_id:
            blob_metadata["agent_id"] = agent_id
        
        # Upload
        blob_client = self.blob_service_client.get_blob_client(
            container=self.container_name,
            blob=blob_name
        )
        
        with open(file_path, "rb") as f:
            blob_client.upload_blob(f, overwrite=overwrite, metadata=blob_metadata)
        
        blob_uri = blob_client.url
        print(f"Uploaded: {file_path.name} -> {blob_uri}")
        return blob_uri

    def upload_file_from_bytes(
        self,
        file_bytes: bytes,
        file_name: str,
        user_id: Optional[str] = None,
        agent_id: Optional[str] = None,
        content_type: Optional[str] = None,
        metadata: Optional[Dict[str, str]] = None,
    ) -> str:
        """
        Upload file from bytes (e.g., from a web upload).
        
        Args:
            file_bytes: File content as bytes
            file_name: Name for the file
            user_id: Optional user ID
            agent_id: Optional agent ID
            content_type: MIME type of the file
            metadata: Optional metadata
            
        Returns:
            Blob URI
        """
        # Construct blob name
        parts = []
        if agent_id:
            parts.append(f"agents/{agent_id}")
        if user_id:
            parts.append(f"users/{user_id}")
        parts.append(file_name)
        blob_name = "/".join(parts)
        
        # Prepare metadata
        blob_metadata = metadata or {}
        blob_metadata.update({
            "original_filename": file_name,
            "uploaded_at": datetime.utcnow().isoformat(),
        })
        if user_id:
            blob_metadata["user_id"] = user_id
        if agent_id:
            blob_metadata["agent_id"] = agent_id
        
        # Upload
        blob_client = self.blob_service_client.get_blob_client(
            container=self.container_name,
            blob=blob_name
        )
        
        blob_client.upload_blob(
            BytesIO(file_bytes),
            overwrite=True,
            metadata=blob_metadata,
            content_settings={"content_type": content_type} if content_type else None
        )
        
        print(f"Uploaded from bytes: {file_name}")
        return blob_client.url

    def upload_files_from_directory(
        self,
        directory: Union[str, Path],
        patterns: List[str] = ["*.pdf", "*.md", "*.txt", "*.docx"],
        user_id: Optional[str] = None,
        agent_id: Optional[str] = None,
        recursive: bool = True,
    ) -> List[str]:
        """
        Upload all matching files from a directory.
        
        Args:
            directory: Path to directory
            patterns: File patterns to match
            user_id: Optional user ID
            agent_id: Optional agent ID
            recursive: Whether to search recursively
            
        Returns:
            List of blob URIs
        """
        directory = Path(directory)
        if not directory.exists():
            raise FileNotFoundError(f"Directory not found: {directory}")
        
        uploaded_uris = []
        for pattern in patterns:
            glob_func = directory.rglob if recursive else directory.glob
            for file_path in glob_func(pattern):
                if file_path.is_file():
                    uri = self.upload_file(
                        file_path=file_path,
                        user_id=user_id,
                        agent_id=agent_id,
                    )
                    uploaded_uris.append(uri)
        
        print(f"Uploaded {len(uploaded_uris)} files from {directory}")
        return uploaded_uris

    # ================== Vector Store Methods ==================

    def create_vector_store_from_blobs(
        self,
        blob_uris: List[str],
        vector_store_name: str = "agent_vector_store",
    ) -> Any:
        """
        Create a vector store from blob URIs.
        
        Args:
            blob_uris: List of blob URIs to include
            vector_store_name: Name for the vector store
            
        Returns:
            Vector store object
        """
        if not self.agents_client:
            raise ValueError("agents_client not initialized. Provide project_endpoint in constructor.")
        
        # Create data sources from blob URIs
        data_sources = [
            VectorStoreDataSource(
                asset_identifier=uri,
                asset_type=VectorStoreDataSourceAssetType.URI_ASSET
            )
            for uri in blob_uris
        ]
        
        # Create vector store
        vector_store = self.agents_client.vector_stores.create_and_poll(
            data_sources=data_sources,
            name=vector_store_name
        )
        
        print(f"Created vector store: {vector_store.id}")
        return vector_store

    def create_vector_store_from_directory(
        self,
        directory: Union[str, Path],
        vector_store_name: str = "agent_vector_store",
        patterns: List[str] = ["*.pdf", "*.md", "*.txt"],
        user_id: Optional[str] = None,
        agent_id: Optional[str] = None,
    ) -> Any:
        """
        Upload files from directory and create a vector store in one step.
        
        Args:
            directory: Path to directory with files
            vector_store_name: Name for the vector store
            patterns: File patterns to match
            user_id: Optional user ID
            agent_id: Optional agent ID
            
        Returns:
            Vector store object
        """
        # Upload files
        blob_uris = self.upload_files_from_directory(
            directory=directory,
            patterns=patterns,
            user_id=user_id,
            agent_id=agent_id,
        )
        
        # Create vector store
        return self.create_vector_store_from_blobs(
            blob_uris=blob_uris,
            vector_store_name=vector_store_name,
        )

    # ================== Helper Methods ==================

    def list_blobs(
        self,
        prefix: Optional[str] = None,
        user_id: Optional[str] = None,
        agent_id: Optional[str] = None,
    ) -> List[Dict[str, Any]]:
        """
        List blobs in the container.
        
        Args:
            prefix: Optional prefix filter
            user_id: Filter by user ID
            agent_id: Filter by agent ID
            
        Returns:
            List of blob info dictionaries
        """
        container_client = self.blob_service_client.get_container_client(self.container_name)
        
        # Build prefix
        if prefix is None:
            if agent_id:
                prefix = f"agents/{agent_id}/"
            elif user_id:
                prefix = f"users/{user_id}/"
        
        blobs = []
        for blob in container_client.list_blobs(name_starts_with=prefix):
            blobs.append({
                "name": blob.name,
                "url": f"{container_client.url}/{blob.name}",
                "size": blob.size,
                "last_modified": blob.last_modified,
                "metadata": blob.metadata,
            })
        
        return blobs

    def delete_blob(self, blob_name: str) -> bool:
        """Delete a specific blob."""
        try:
            blob_client = self.blob_service_client.get_blob_client(
                container=self.container_name,
                blob=blob_name
            )
            blob_client.delete_blob()
            print(f"Deleted blob: {blob_name}")
            return True
        except Exception as e:
            print(f"Error deleting blob: {e}")
            return False

    def delete_user_blobs(self, user_id: str, agent_id: Optional[str] = None) -> int:
        """Delete all blobs for a specific user (optionally filtered by agent)."""
        prefix = f"agents/{agent_id}/users/{user_id}/" if agent_id else f"users/{user_id}/"
        blobs = self.list_blobs(prefix=prefix)
        
        count = 0
        for blob in blobs:
            if self.delete_blob(blob["name"]):
                count += 1
        
        print(f"Deleted {count} blobs for user {user_id}")
        return count

    def generate_sas_url(
        self,
        blob_name: str,
        expiry_hours: int = 24,
        permissions: str = "r",
    ) -> str:
        """
        Generate a SAS URL for a blob (for temporary access).
        
        Args:
            blob_name: Name of the blob
            expiry_hours: Hours until SAS expires
            permissions: Permission string (r=read, w=write, d=delete)
            
        Returns:
            SAS URL
        """
        blob_client = self.blob_service_client.get_blob_client(
            container=self.container_name,
            blob=blob_name
        )
        
        # Get account key from credential (only works with connection string auth)
        # For managed identity, use user delegation SAS
        sas_token = generate_blob_sas(
            account_name=self.storage_account_name,
            container_name=self.container_name,
            blob_name=blob_name,
            account_key=None,  # Will use credential
            permission=BlobSasPermissions(read="r" in permissions, write="w" in permissions),
            expiry=datetime.utcnow() + timedelta(hours=expiry_hours),
        )
        
        return f"{blob_client.url}?{sas_token}"


# ================== Convenience Functions ==================

def create_agent_with_blob_files(
    project_endpoint: str,
    storage_account_name: str,
    files_directory: str,
    agent_name: str = "file-search-agent",
    agent_instructions: str = "You are a helpful assistant that can search uploaded files.",
    model: str = "gpt-4o",
    container_name: str = "agent-files",
    file_patterns: List[str] = ["*.pdf", "*.md", "*.txt", "*.docx"],
    user_id: Optional[str] = None,
    index_name: Optional[str] = None,
    search_connection_id: Optional[str] = None,
) -> Dict[str, Any]:
    """
    Complete workflow to create an agent with files from Blob Storage.
    
    NOTE: FileSearchTool is deprecated. Use index_name and search_connection_id
    for Azure AI Search retrieval instead.
    
    Args:
        project_endpoint: Azure AI Project endpoint
        storage_account_name: Azure Storage Account name
        files_directory: Local directory with files to upload
        agent_name: Name for the agent
        agent_instructions: System instructions for the agent
        model: Model to use
        container_name: Blob container name
        file_patterns: File patterns to match
        user_id: Optional user ID for file organization
        index_name: Azure AI Search index name (for retrieval)
        search_connection_id: Azure AI Search connection ID
        
    Returns:
        Dictionary with agent and vector_store info
    """
    # Initialize manager
    manager = BlobStorageManager(
        storage_account_name=storage_account_name,
        container_name=container_name,
        project_endpoint=project_endpoint,
    )
    
    # Upload files and create vector store
    vector_store = manager.create_vector_store_from_directory(
        directory=files_directory,
        vector_store_name=f"{agent_name}_vectorstore",
        patterns=file_patterns,
        user_id=user_id,
    )
    
    # Create agent - NOTE: FileSearchTool is deprecated
    tools = []
    tool_resources = {}
    
    if index_name and search_connection_id:
        ai_search = AzureAISearchTool(
            index_connection_id=search_connection_id,
            index_name=index_name,
            query_type=AzureAISearchQueryType.VECTOR_SEMANTIC_HYBRID,
        )
        tools = list(ai_search.definitions)
        tool_resources = ai_search.resources
        print(f"Using Azure AI Search index: {index_name}")
    else:
        print("WARNING: No Azure AI Search index provided - agent created without retrieval tool")
    
    # Create agent
    agent = manager.agents_client.create_agent(
        model=model,
        name=agent_name,
        instructions=agent_instructions,
        tools=tools,
        tool_resources=tool_resources,
    )
    
    print(f"Created agent: {agent.id} with vector store: {vector_store.id}")
    
    return {
        "agent": agent,
        "agent_id": agent.id,
        "vector_store": vector_store,
        "vector_store_id": vector_store.id,
        "manager": manager,
    }


# ================== Example Usage ==================

if __name__ == "__main__":
    # Example 1: Simple file upload
    manager = BlobStorageManager(
        storage_account_name=os.environ["STORAGE_ACCOUNT_NAME"],
        container_name="agent-files",
        project_endpoint=os.environ.get("PROJECT_ENDPOINT"),
    )
    
    # Upload a single file
    # uri = manager.upload_file("./documents/handbook.pdf", user_id="user123", agent_id="agent456")
    
    # Example 2: Create agent with files
    # result = create_agent_with_blob_files(
    #     project_endpoint="https://your-project.services.ai.azure.com/api/projects/your-project",
    #     storage_account_name="yourstorageaccount",
    #     files_directory="./course_materials",
    #     agent_name="course-assistant",
    #     agent_instructions="You help students with course materials.",
    #     user_id="teacher_001",
    # )
    # print(f"Agent ID: {result['agent_id']}")
    
    print("BlobStorageManager ready for use!")


# ================== Document Intelligence PDF Extraction ==================

class DocumentIntelligenceExtractor:
    """
    Extract text from PDFs using Azure Document Intelligence.
    
    This uses Azure's Document Intelligence service (formerly Form Recognizer)
    for OCR and layout analysis. It's more cost-effective than GPT-4o based OCR
    and works well for scanned documents.
    
    Usage:
        extractor = DocumentIntelligenceExtractor(
            endpoint="https://your-resource.cognitiveservices.azure.com/"
        )
        
        # Extract text from a PDF file
        text = extractor.extract_text_from_pdf("./document.pdf")
        
        # Extract text from bytes (e.g., from uploaded file)
        text = extractor.extract_text_from_bytes(pdf_bytes)
        
        # Convert PDF to markdown and upload
        manager = BlobStorageManager(...)
        blob_uri = extractor.extract_and_upload(
            pdf_path="./document.pdf",
            blob_manager=manager,
            user_id="user123"
        )
    """
    
    def __init__(
        self,
        endpoint: Optional[str] = None,
        credential: Optional[Any] = None,
        model_id: str = "prebuilt-layout",
    ):
        """
        Initialize the Document Intelligence extractor.
        
        Args:
            endpoint: Document Intelligence endpoint (or set DOCUMENT_INTELLIGENCE_ENDPOINT env var)
            credential: Azure credential (defaults to DefaultAzureCredential)
            model_id: Model to use - "prebuilt-layout" for general docs, "prebuilt-read" for simple text
        """
        self.endpoint = endpoint or os.environ["DOCUMENT_INTELLIGENCE_ENDPOINT"]
        self.credential = credential or _default_sync_credential()
        self.model_id = model_id
        
        # Lazy load the client
        self._client = None
    
    @property
    def client(self):
        """Lazy-load the Document Intelligence client."""
        if self._client is None:
            try:
                from azure.ai.documentintelligence import DocumentIntelligenceClient
                self._client = DocumentIntelligenceClient(
                    endpoint=self.endpoint,
                    credential=self.credential
                )
            except ImportError:
                raise ImportError(
                    "azure-ai-documentintelligence package not installed. "
                    "Run: pip install azure-ai-documentintelligence"
                )
        return self._client
    
    def extract_text_from_pdf(
        self,
        pdf_path: Union[str, Path],
        output_format: str = "text",
    ) -> str:
        """
        Extract text from a PDF file.
        
        Args:
            pdf_path: Path to the PDF file
            output_format: "text" for plain text, "markdown" for markdown format
            
        Returns:
            Extracted text content
        """
        pdf_path = Path(pdf_path)
        if not pdf_path.exists():
            raise FileNotFoundError(f"PDF not found: {pdf_path}")
        
        with open(pdf_path, "rb") as f:
            return self.extract_text_from_bytes(f.read(), output_format)
    
    def extract_text_from_bytes(
        self,
        pdf_bytes: bytes,
        output_format: str = "text",
    ) -> str:
        """
        Extract text from PDF bytes.
        
        Args:
            pdf_bytes: PDF file content as bytes
            output_format: "text" for plain text, "markdown" for markdown format
            
        Returns:
            Extracted text content
        """
        poller = self.client.begin_analyze_document(
            model_id=self.model_id,
            body=BytesIO(pdf_bytes),
            content_type="application/pdf"
        )
        
        result = poller.result()
        
        if output_format == "markdown":
            return self._result_to_markdown(result)
        else:
            return self._result_to_text(result)
    
    def _result_to_text(self, result) -> str:
        """Convert Document Intelligence result to plain text."""
        pages_text = []
        for page in result.pages:
            lines = [line.content for line in page.lines]
            pages_text.append("\n".join(lines))
        return "\n\n".join(pages_text)
    
    def _result_to_markdown(self, result) -> str:
        """Convert Document Intelligence result to markdown format."""
        markdown_parts = []
        
        for page_num, page in enumerate(result.pages, 1):
            markdown_parts.append(f"## Page {page_num}\n")
            
            # Extract paragraphs if available
            if hasattr(result, 'paragraphs') and result.paragraphs:
                page_paragraphs = [
                    p for p in result.paragraphs 
                    if any(br.page_number == page_num for br in getattr(p, 'bounding_regions', []))
                ]
                for para in page_paragraphs:
                    role = getattr(para, 'role', None)
                    content = para.content
                    
                    # Format based on role
                    if role == 'title':
                        markdown_parts.append(f"# {content}\n")
                    elif role == 'sectionHeading':
                        markdown_parts.append(f"### {content}\n")
                    else:
                        markdown_parts.append(f"{content}\n")
            else:
                # Fallback to line-by-line
                lines = [line.content for line in page.lines]
                markdown_parts.append("\n".join(lines))
            
            markdown_parts.append("\n---\n")
        
        # Add tables if present
        if hasattr(result, 'tables') and result.tables:
            markdown_parts.append("\n## Tables\n")
            for table_num, table in enumerate(result.tables, 1):
                markdown_parts.append(f"\n### Table {table_num}\n")
                markdown_parts.append(self._table_to_markdown(table))
        
        return "\n".join(markdown_parts)
    
    def _table_to_markdown(self, table) -> str:
        """Convert a Document Intelligence table to markdown format."""
        if not table.cells:
            return ""
        
        # Determine table dimensions
        max_row = max(cell.row_index for cell in table.cells)
        max_col = max(cell.column_index for cell in table.cells)
        
        # Create empty grid
        grid = [["" for _ in range(max_col + 1)] for _ in range(max_row + 1)]
        
        # Fill grid with cell content
        for cell in table.cells:
            grid[cell.row_index][cell.column_index] = cell.content.replace("\n", " ")
        
        # Convert to markdown table
        lines = []
        for row_num, row in enumerate(grid):
            lines.append("| " + " | ".join(row) + " |")
            if row_num == 0:
                lines.append("| " + " | ".join(["---"] * len(row)) + " |")
        
        return "\n".join(lines)
    
    def extract_and_upload(
        self,
        pdf_path: Union[str, Path],
        blob_manager: BlobStorageManager,
        user_id: Optional[str] = None,
        agent_id: Optional[str] = None,
        output_format: str = "markdown",
        keep_original: bool = True,
    ) -> Dict[str, str]:
        """
        Extract text from PDF and upload both original and extracted text to blob storage.
        
        Args:
            pdf_path: Path to the PDF file
            blob_manager: BlobStorageManager instance
            user_id: Optional user ID for file organization
            agent_id: Optional agent ID for file organization
            output_format: "text" or "markdown" for extracted content
            keep_original: Whether to also upload the original PDF
            
        Returns:
            Dictionary with blob URIs for original and extracted files
        """
        pdf_path = Path(pdf_path)
        result = {}
        
        # Upload original PDF if requested
        if keep_original:
            original_uri = blob_manager.upload_file(
                file_path=pdf_path,
                user_id=user_id,
                agent_id=agent_id,
            )
            result["original_pdf_uri"] = original_uri
        
        # Extract text
        extracted_text = self.extract_text_from_pdf(pdf_path, output_format)
        
        # Upload extracted text
        extension = ".md" if output_format == "markdown" else ".txt"
        extracted_filename = pdf_path.stem + "_extracted" + extension
        
        extracted_uri = blob_manager.upload_file_from_bytes(
            file_bytes=extracted_text.encode("utf-8"),
            file_name=extracted_filename,
            user_id=user_id,
            agent_id=agent_id,
            content_type="text/markdown" if output_format == "markdown" else "text/plain",
        )
        result["extracted_text_uri"] = extracted_uri
        result["extracted_text"] = extracted_text
        
        logger.info(f"Extracted and uploaded: {pdf_path.name} -> {extracted_filename}")
        return result
    
    def batch_extract_and_upload(
        self,
        pdf_directory: Union[str, Path],
        blob_manager: BlobStorageManager,
        user_id: Optional[str] = None,
        agent_id: Optional[str] = None,
        output_format: str = "markdown",
    ) -> List[Dict[str, str]]:
        """
        Extract text from all PDFs in a directory and upload to blob storage.
        
        Args:
            pdf_directory: Directory containing PDF files
            blob_manager: BlobStorageManager instance
            user_id: Optional user ID
            agent_id: Optional agent ID
            output_format: "text" or "markdown"
            
        Returns:
            List of result dictionaries with blob URIs
        """
        pdf_directory = Path(pdf_directory)
        results = []
        
        for pdf_path in pdf_directory.glob("*.pdf"):
            try:
                result = self.extract_and_upload(
                    pdf_path=pdf_path,
                    blob_manager=blob_manager,
                    user_id=user_id,
                    agent_id=agent_id,
                    output_format=output_format,
                )
                result["filename"] = pdf_path.name
                result["success"] = True
                results.append(result)
            except Exception as e:
                logger.error(f"Error extracting {pdf_path.name}: {e}")
                results.append({
                    "filename": pdf_path.name,
                    "success": False,
                    "error": str(e)
                })
        
        return results


# ================== Combined Workflow ==================

def create_agent_with_pdf_extraction(
    project_endpoint: str,
    storage_account_name: str,
    pdf_directory: str,
    document_intelligence_endpoint: str,
    agent_name: str = "document-assistant",
    agent_instructions: str = "You help users understand uploaded documents.",
    model: str = "gpt-4o",
    user_id: Optional[str] = None,
    extract_format: str = "markdown",
    index_name: Optional[str] = None,
    search_connection_id: Optional[str] = None,
) -> Dict[str, Any]:
    """
    Complete workflow: Extract text from PDFs using Document Intelligence,
    upload to Blob Storage, create vector store, and create an agent.
    
    NOTE: FileSearchTool is deprecated. Use index_name and search_connection_id
    for Azure AI Search retrieval instead.
    
    Args:
        project_endpoint: Azure AI Project endpoint
        storage_account_name: Azure Storage Account name
        pdf_directory: Directory containing PDF files
        document_intelligence_endpoint: Document Intelligence endpoint
        agent_name: Name for the agent
        agent_instructions: System instructions
        model: Model to use
        user_id: Optional user ID
        extract_format: "text" or "markdown"
        index_name: Azure AI Search index name (for retrieval)
        search_connection_id: Azure AI Search connection ID
        
    Returns:
        Dictionary with agent, vector_store, and extraction results
    """
    # Initialize managers
    blob_manager = BlobStorageManager(
        storage_account_name=storage_account_name,
        container_name="agent-files",
        project_endpoint=project_endpoint,
    )
    
    extractor = DocumentIntelligenceExtractor(
        endpoint=document_intelligence_endpoint
    )
    
    # Extract and upload all PDFs
    extraction_results = extractor.batch_extract_and_upload(
        pdf_directory=pdf_directory,
        blob_manager=blob_manager,
        user_id=user_id,
        agent_id=agent_name,
        output_format=extract_format,
    )
    
    # Collect extracted text URIs for vector store
    blob_uris = [
        r["extracted_text_uri"] 
        for r in extraction_results 
        if r.get("success") and r.get("extracted_text_uri")
    ]
    
    if not blob_uris:
        raise ValueError("No files were successfully extracted")
    
    # Create vector store
    vector_store = blob_manager.create_vector_store_from_blobs(
        blob_uris=blob_uris,
        vector_store_name=f"{agent_name}_vectorstore",
    )
    
    # Create agent - NOTE: FileSearchTool is deprecated
    tools = []
    tool_resources = {}
    
    if index_name and search_connection_id:
        ai_search = AzureAISearchTool(
            index_connection_id=search_connection_id,
            index_name=index_name,
            query_type=AzureAISearchQueryType.VECTOR_SEMANTIC_HYBRID,
        )
        tools = list(ai_search.definitions)
        tool_resources = ai_search.resources
        logger.info(f"Using Azure AI Search index: {index_name}")
    else:
        logger.warning("No Azure AI Search index provided - agent created without retrieval tool")
    
    agent = blob_manager.agents_client.create_agent(
        model=model,
        name=agent_name,
        instructions=agent_instructions,
        tools=tools,
        tool_resources=tool_resources,
    )
    
    logger.info(f"Created agent: {agent.id} with {len(blob_uris)} extracted documents")
    
    return {
        "agent": agent,
        "agent_id": agent.id,
        "vector_store": vector_store,
        "vector_store_id": vector_store.id,
        "extraction_results": extraction_results,
        "files_processed": len(extraction_results),
        "files_successful": len(blob_uris),
    }
