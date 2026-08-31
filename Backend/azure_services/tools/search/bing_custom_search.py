# azure_services/bing_custom_search.py
"""
Bing Custom Search Configuration Management

This module provides functions to programmatically create and manage 
Bing Custom Search configurations for per-agent URL restrictions.

Each agent can have its own custom search configuration with teacher-curated URLs.
"""

import os
import logging
import httpx
from typing import List, Optional, Dict, Any

logger = logging.getLogger(__name__)

# Bing Custom Search API endpoints
BING_CUSTOM_SEARCH_API = "https://api.bing.microsoft.com/v7.0/custom"
BING_CUSTOM_CONFIG_API = "https://www.customsearch.ai/api/endpoint"

# Get Bing Custom Search API key from environment
BING_CUSTOM_SEARCH_API_KEY = os.getenv("BING_CUSTOM_SEARCH_API_KEY", "")

# Default instance ID (from Azure Portal configuration)
DEFAULT_CUSTOM_CONFIG_ID = os.getenv("BING_CUSTOM_SEARCH_CONFIG_ID", "")


class BingCustomSearchConfig:
    """
    Manages Bing Custom Search configurations for agents.
    
    Each agent can have a configuration that restricts searches to specific URLs
    provided by the teacher.
    """
    
    def __init__(self, api_key: Optional[str] = None):
        self.api_key = api_key or BING_CUSTOM_SEARCH_API_KEY
        if not self.api_key:
            logger.warning("BING_CUSTOM_SEARCH_API_KEY not set - custom search configuration disabled")
    
    def _extract_domain(self, url: str) -> str:
        """Extract domain from URL for Bing Custom Search site configuration."""
        # Remove protocol
        url = url.replace("https://", "").replace("http://", "")
        # Remove path
        domain = url.split("/")[0]
        # Remove www prefix for cleaner matching
        if domain.startswith("www."):
            domain = domain[4:]
        return domain
    
    def _build_site_list(self, urls: List[str]) -> List[Dict[str, Any]]:
        """
        Build the site list format required by Bing Custom Search.
        
        Each site entry includes:
        - url: The domain or URL pattern
        - includeSubdomains: Whether to include subdomains
        """
        sites = []
        seen_domains = set()
        
        for url in urls:
            domain = self._extract_domain(url)
            if domain and domain not in seen_domains:
                seen_domains.add(domain)
                sites.append({
                    "url": domain,
                    "includeSubdomains": True,
                })
        
        return sites
    
    async def create_search_config_for_agent(
        self,
        agent_id: str,
        agent_name: str,
        urls: List[str],
    ) -> Optional[Dict[str, Any]]:
        """
        Create a custom search configuration for an agent with the given URLs.
        
        Note: Bing Custom Search configurations are typically managed via the portal.
        This method creates a configuration object that can be used with the 
        BingCustomSearchTool.
        
        For now, we'll use the default instance but store the URL restrictions
        in the agent's metadata for reference.
        
        Args:
            agent_id: The agent's ID
            agent_name: The agent's name (used for configuration naming)
            urls: List of URLs to restrict searches to
            
        Returns:
            Configuration info dict or None if failed
        """
        if not urls:
            logger.info(f"No URLs provided for agent {agent_name}, skipping custom search config")
            return None
        
        sites = self._build_site_list(urls)
        logger.info(f"Creating custom search config for agent '{agent_name}' with {len(sites)} sites")
        
        # Build configuration object
        config = {
            "agent_id": agent_id,
            "agent_name": agent_name,
            "instance_name": "agentic_shiksha_custom_websearch",  # Use default instance
            "sites": sites,
            "original_urls": urls,
        }
        
        # Log the sites that will be used
        for site in sites:
            logger.info(f"  - {site['url']} (includeSubdomains: {site['includeSubdomains']})")
        
        return config
    
    async def search_with_urls(
        self,
        query: str,
        urls: List[str],
        count: int = 10,
    ) -> Optional[Dict[str, Any]]:
        """
        Perform a custom search restricted to the given URLs.
        
        This uses the Bing Custom Search API with site restrictions.
        
        Args:
            query: Search query
            urls: List of URLs/domains to restrict search to
            count: Number of results to return
            
        Returns:
            Search results or None if failed
        """
        if not self.api_key:
            logger.error("Cannot perform custom search: API key not configured")
            return None
        
        if not urls:
            logger.warning("No URLs provided for custom search")
            return None
        
        # Build site restriction query
        domains = [self._extract_domain(url) for url in urls]
        site_query = " OR ".join([f"site:{domain}" for domain in domains if domain])
        full_query = f"({query}) ({site_query})"
        
        logger.info(f"Custom search query: {full_query}")
        
        try:
            async with httpx.AsyncClient() as client:
                response = await client.get(
                    f"{BING_CUSTOM_SEARCH_API}/search",
                    params={
                        "q": full_query,
                        "count": count,
                        "customConfig": DEFAULT_CUSTOM_CONFIG_ID,
                    },
                    headers={
                        "Ocp-Apim-Subscription-Key": self.api_key,
                    },
                    timeout=30.0,
                )
                
                if response.status_code == 200:
                    return response.json()
                else:
                    logger.error(f"Custom search failed: {response.status_code} - {response.text}")
                    return None
                    
        except Exception as e:
            logger.error(f"Custom search error: {e}")
            return None


# Singleton instance
_bing_custom_search: Optional[BingCustomSearchConfig] = None


def get_bing_custom_search() -> BingCustomSearchConfig:
    """Get the singleton BingCustomSearchConfig instance."""
    global _bing_custom_search
    if _bing_custom_search is None:
        _bing_custom_search = BingCustomSearchConfig()
    return _bing_custom_search


async def create_agent_search_config(
    agent_id: str,
    agent_name: str, 
    urls: List[str],
) -> Optional[Dict[str, Any]]:
    """
    Convenience function to create a custom search configuration for an agent.
    
    Args:
        agent_id: The agent's ID
        agent_name: The agent's name
        urls: List of teacher-curated URLs
        
    Returns:
        Configuration info or None
    """
    config = get_bing_custom_search()
    return await config.create_search_config_for_agent(agent_id, agent_name, urls)
