"""
Section Detector - Detect logical sections in documents using Document Intelligence.

This module detects logical sections (e.g., "Question Paper 1", "Chapter 3") in PDFs
and can split documents into separate logical parts for better retrieval.

Usage:
    from utils.section_detector import SectionDetector
    
    detector = SectionDetector()
    sections = detector.detect_sections(pdf_bytes)
    # Returns: [
    #   {"section_name": "Question Paper 1", "start_page": 1, "end_page": 5, "content": "..."},
    #   {"section_name": "Question Paper 2", "start_page": 6, "end_page": 10, "content": "..."},
    # ]
"""

import os
import re
import logging
from io import BytesIO
from typing import List, Dict, Any, Optional, Tuple
from pathlib import Path

logger = logging.getLogger(__name__)


# Common section header patterns for educational content
SECTION_PATTERNS = [
    # Question papers
    r"(?i)^(?:question|exam|test)\s*paper\s*(?:no\.?\s*)?(\d+)",
    r"(?i)^(?:paper|exam)\s*[-#:]?\s*(\d+)",
    r"(?i)^(?:set|version)\s*[-:]?\s*([A-Za-z\d]+)",
    # Chapters
    r"(?i)^chapter\s*(\d+)",
    r"(?i)^unit\s*(\d+)",
    r"(?i)^module\s*(\d+)",
    r"(?i)^lesson\s*(\d+)",
    r"(?i)^part\s*(\d+|[IV]+)",
    # Sections
    r"(?i)^section\s*([A-Za-z\d]+)",
    # Generic numbered sections
    r"^(\d+)\s*[-\.]\s+[A-Z]",
]


class SectionDetector:
    """
    Detect logical sections in documents using Document Intelligence.
    
    This helps with documents that contain multiple logical parts
    (e.g., a PDF with 100 question papers) by identifying section boundaries
    and optionally splitting the content.
    """
    
    def __init__(
        self,
        endpoint: Optional[str] = None,
        credential: Optional[Any] = None,
        patterns: Optional[List[str]] = None,
    ):
        """
        Initialize the section detector.
        
        Args:
            endpoint: Document Intelligence endpoint
            credential: Azure credential
            patterns: Custom regex patterns for section detection
        """
        self.endpoint = endpoint or os.environ["AI_DOCUMENT_INTELLIGENCE_ENDPOINT"]
        self.credential = credential
        self.patterns = patterns or SECTION_PATTERNS
        self._client = None
    
    @property
    def client(self):
        """Lazy-load the Document Intelligence client."""
        if self._client is None:
            try:
                from azure.ai.documentintelligence import DocumentIntelligenceClient
                from azure.identity import DefaultAzureCredential
                
                self._client = DocumentIntelligenceClient(
                    endpoint=self.endpoint,
                    credential=self.credential or DefaultAzureCredential()
                )
            except ImportError:
                raise ImportError(
                    "azure-ai-documentintelligence not installed. "
                    "Run: pip install azure-ai-documentintelligence"
                )
        return self._client
    
    def detect_sections(
        self,
        pdf_bytes: bytes,
        detect_by: str = "headings",  # "headings" or "pages"
    ) -> List[Dict[str, Any]]:
        """
        Detect logical sections in a PDF.
        
        Args:
            pdf_bytes: PDF content as bytes
            detect_by: Detection strategy - "headings" uses DI heading detection,
                      "pages" treats each page as a section
        
        Returns:
            List of sections with:
                - section_name: Detected section name (e.g., "Question Paper 1")
                - section_index: 0-based index
                - start_page: First page of section (1-based)
                - end_page: Last page of section (1-based)
                - content: Text content of the section
                - paragraphs: List of paragraph objects
        """
        logger.info("Analyzing document for sections...")
        
        # Analyze document
        poller = self.client.begin_analyze_document(
            model_id="prebuilt-layout",
            body=BytesIO(pdf_bytes),
            content_type="application/pdf"
        )
        result = poller.result()
        
        if detect_by == "pages":
            return self._detect_by_pages(result)
        else:
            return self._detect_by_headings(result)
    
    def _detect_by_headings(self, result) -> List[Dict[str, Any]]:
        """
        Detect sections based on heading patterns.
        
        Uses Document Intelligence paragraph roles (title, sectionHeading)
        combined with regex pattern matching.
        """
        sections = []
        current_section = None
        
        # Get all paragraphs with their page numbers
        paragraphs = []
        if hasattr(result, 'paragraphs') and result.paragraphs:
            for para in result.paragraphs:
                # Get page number from bounding regions
                page_num = 1
                if hasattr(para, 'bounding_regions') and para.bounding_regions:
                    page_num = para.bounding_regions[0].page_number
                
                role = getattr(para, 'role', None)
                content = para.content.strip()
                
                paragraphs.append({
                    "content": content,
                    "page": page_num,
                    "role": role,
                })
        
        # Find section boundaries
        section_starts = []
        
        for i, para in enumerate(paragraphs):
            content = para["content"]
            role = para["role"]
            page = para["page"]
            
            # Check if this looks like a section header
            is_section = False
            section_name = None
            
            # Check DI-detected headings
            if role in ['title', 'sectionHeading']:
                # Match against patterns
                for pattern in self.patterns:
                    match = re.match(pattern, content)
                    if match:
                        is_section = True
                        section_name = content
                        break
                
                # Also consider any heading at the start of a new page
                if not is_section and len(section_starts) == 0:
                    # First heading in document
                    is_section = True
                    section_name = content
            
            # Also check first lines of pages for section headers
            if not is_section:
                for pattern in self.patterns:
                    match = re.match(pattern, content)
                    if match:
                        is_section = True
                        section_name = content
                        break
            
            if is_section and section_name:
                section_starts.append({
                    "index": len(section_starts),
                    "name": section_name,
                    "para_index": i,
                    "page": page,
                })
        
        # If no sections found, treat entire document as one section
        if not section_starts:
            all_content = "\n".join([p["content"] for p in paragraphs])
            return [{
                "section_name": "Full Document",
                "section_index": 0,
                "start_page": 1,
                "end_page": len(result.pages) if hasattr(result, 'pages') else 1,
                "content": all_content,
                "paragraph_count": len(paragraphs),
            }]
        
        # Build sections from boundaries
        for i, section_start in enumerate(section_starts):
            # Find end of this section (start of next, or end of doc)
            if i + 1 < len(section_starts):
                next_start = section_starts[i + 1]
                end_para = next_start["para_index"]
                end_page = next_start["page"] - 1  # Previous page
            else:
                end_para = len(paragraphs)
                end_page = len(result.pages) if hasattr(result, 'pages') else section_start["page"]
            
            # Collect content for this section
            section_paragraphs = paragraphs[section_start["para_index"]:end_para]
            section_content = "\n".join([p["content"] for p in section_paragraphs])
            
            sections.append({
                "section_name": section_start["name"],
                "section_index": section_start["index"],
                "start_page": section_start["page"],
                "end_page": max(section_start["page"], end_page),
                "content": section_content,
                "paragraph_count": len(section_paragraphs),
            })
        
        logger.info(f"Detected {len(sections)} sections")
        for s in sections:
            logger.info(f"  - {s['section_name']} (pages {s['start_page']}-{s['end_page']})")
        
        return sections
    
    def _detect_by_pages(self, result) -> List[Dict[str, Any]]:
        """
        Treat each page as a separate section.
        """
        sections = []
        
        for page_num, page in enumerate(result.pages, 1):
            lines = [line.content for line in page.lines]
            content = "\n".join(lines)
            
            sections.append({
                "section_name": f"Page {page_num}",
                "section_index": page_num - 1,
                "start_page": page_num,
                "end_page": page_num,
                "content": content,
                "paragraph_count": len(lines),
            })
        
        return sections
    
    def split_pdf_by_sections(
        self,
        pdf_bytes: bytes,
    ) -> List[Dict[str, Any]]:
        """
        Split a PDF into separate byte streams by detected sections.
        
        Note: This requires PyPDF2 or pdf2image. Currently returns
        section metadata with content, not separate PDF files.
        
        Args:
            pdf_bytes: PDF content
            
        Returns:
            List of sections with content and metadata
        """
        # For now, just detect sections and return metadata
        # Full PDF splitting would require additional libraries
        return self.detect_sections(pdf_bytes)


def detect_sections_in_document(pdf_bytes: bytes) -> List[Dict[str, Any]]:
    """
    Convenience function to detect sections in a PDF.
    
    Args:
        pdf_bytes: PDF file content
        
    Returns:
        List of detected sections
    """
    detector = SectionDetector()
    return detector.detect_sections(pdf_bytes)


def get_logical_section(content: str, patterns: Optional[List[str]] = None) -> Optional[str]:
    """
    Extract the logical section name from a text chunk.
    
    Useful for tagging chunks with their parent section after indexing.
    
    Args:
        content: Text content to analyze
        patterns: Regex patterns to match (uses defaults if not provided)
        
    Returns:
        Section name if found, None otherwise
    """
    patterns = patterns or SECTION_PATTERNS
    
    # Check first few lines
    lines = content.strip().split('\n')[:5]
    
    for line in lines:
        line = line.strip()
        for pattern in patterns:
            match = re.match(pattern, line)
            if match:
                return line
    
    return None
