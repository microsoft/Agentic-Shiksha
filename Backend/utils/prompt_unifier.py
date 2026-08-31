"""
Prompt Unifier
--------------
Combines all prompt modules + learning/exam prompts from CACA into final agent instructions.
Also handles loading prompts from markdown files.
"""

import re
from pathlib import Path
from typing import Optional, Dict

# Directory containing prompt files
PROMPT_STORE_DIR = Path(__file__).parent.parent / "prompt_store"
AGENT_PROMPTS_DIR = PROMPT_STORE_DIR / "core_agent_prompts"


# ===================== Prompt Loading Functions =====================

def load_prompt(prompt_name: str) -> str:
    """
    Load a prompt from a markdown file.
    
    Args:
        prompt_name: Name of the prompt file (without .md extension)
                     e.g., "agent_behavior", "pedagogical", "safety_guardrails"
    
    Returns:
        The prompt content as a string.
    
    Raises:
        FileNotFoundError: If the prompt file doesn't exist.
    """
    prompt_path = AGENT_PROMPTS_DIR / f"{prompt_name}.md"
    
    if not prompt_path.exists():
        raise FileNotFoundError(f"Prompt file not found: {prompt_path}")
    
    with open(prompt_path, "r", encoding="utf-8") as f:
        return f.read().strip()


def load_prompt_file(relative_path: str) -> str:
    """
    Load a prompt from any markdown/text file under the prompt_store directory.

    This is the general-purpose loader for prompts that live outside the
    ``core_agent_prompts`` folder (e.g. research agents, tools, evaluation).

    Args:
        relative_path: Path relative to ``prompt_store/``, using forward slashes,
                       e.g. ``"research_agents/institute_research_agent.md"``.

    Returns:
        The prompt content as a string (surrounding whitespace stripped).

    Raises:
        FileNotFoundError: If the prompt file doesn't exist.
    """
    prompt_path = PROMPT_STORE_DIR / relative_path

    if not prompt_path.exists():
        raise FileNotFoundError(f"Prompt file not found: {prompt_path}")

    return prompt_path.read_text(encoding="utf-8").strip()


def get_all_prompts() -> Dict[str, str]:
    """Load all standard prompt files."""
    prompt_names = ["agent_behavior", "pedagogical_framework", "knowledge_grounding", "tool_handling", "safety_guardrails"]
    return {name: load_prompt(name) for name in prompt_names}


# Convenience functions for each prompt type
def get_agent_behavior_prompt() -> str:
    """Returns the agent behavior prompt."""
    return load_prompt("agent_behavior")


def get_pedagogical_prompt() -> str:
    """Returns the pedagogical framework prompt."""
    return load_prompt("pedagogical_framework")


def get_knowledge_grounding_prompt() -> str:
    """Returns the knowledge grounding prompt."""
    return load_prompt("knowledge_grounding")


def get_tool_handling_prompt() -> str:
    """Returns the tool handling prompt."""
    return load_prompt("tool_handling")


def get_safety_guardrails_prompt() -> str:
    """Returns the safety guardrails prompt."""
    return load_prompt("safety_guardrails")


# ===================== Prompt Unification =====================


UNIFIED_PROMPT_TEMPLATE = """
# {course_name} - Course Assistant

You are an AI-powered educational assistant for the course "{course_name}".
{level_info}{duration_info}

Your primary role is to help students learn, understand concepts, answer questions, and guide them through the course material effectively.

---

{agent_behavior}

---

{pedagogical_framework}

---

{course_specific_section}

---

{tool_handling}

---

{knowledge_grounding}

---

{safety_guardrails}
"""


def unify_agent_prompts(
    course_name: str,
    course_level: Optional[str] = None,
    course_duration: Optional[str] = None,
    learning_prompt: Optional[str] = None,
    exam_prompt: Optional[str] = None,
    additional_context: Optional[str] = None,
    include_agent_behavior: bool = True,
    include_pedagogical_framework: bool = True,
    include_tool_handling: bool = True,
    include_knowledge_grounding: bool = True,
    include_safety_guardrails: bool = True,
) -> str:
    """
    Unifies all prompt components into a single agent instruction set.
    
    The five core modules (agent_behavior, pedagogical_framework, tool_handling,
    knowledge_grounding, safety_guardrails) provide all generic behaviors.
    
    The learning_prompt from CACA provides ONLY course-specific content:
    identity, threshold concept examples, notation profile, contextual framing,
    and teacher preferences. It must not duplicate core modules.
    
    Args:
        course_name: Name of the course
        course_level: Difficulty level (e.g., "Beginner", "Intermediate", "Advanced")
        course_duration: Duration of the course (e.g., "12 weeks", "1 semester")
        learning_prompt: Course-specific prompt from CACA (Teaching Assistant Creation Agent)
        exam_prompt: Additional exam/assessment notes from CACA (optional, merged into course section)
        additional_context: Any additional context or notes about the course
        include_agent_behavior: Whether to include agent behavior instructions
        include_pedagogical_framework: Whether to include pedagogical teaching principles
        include_tool_handling: Whether to include tool handling instructions
        include_knowledge_grounding: Whether to include knowledge grounding instructions
        include_safety_guardrails: Whether to include safety guardrails
    
    Returns:
        Unified prompt string for the agent
    """
    
    # Build level and duration info
    level_info = f"\nCourse Level: {course_level}" if course_level else ""
    duration_info = f"\nCourse Duration: {course_duration}" if course_duration else ""
    
    # Build course-specific section from CACA output
    # If no CACA output is provided, include a minimal placeholder.
    # Do NOT inject generic teaching/assessment guidelines — those are in the core modules.
    parts = []
    if learning_prompt:
        parts.append(f"## Course-Specific Configuration\n\n{learning_prompt}")
    if exam_prompt:
        parts.append(f"## Assessment Notes\n\n{exam_prompt}")
    if additional_context:
        parts.append(f"## Additional Course Context\n\n{additional_context}")
    
    course_specific_section = "\n\n".join(parts) if parts else ""

    # Load prompts from markdown files
    agent_behavior = get_agent_behavior_prompt() if include_agent_behavior else ""
    pedagogical_framework = get_pedagogical_prompt() if include_pedagogical_framework else ""
    tool_handling = get_tool_handling_prompt() if include_tool_handling else ""
    knowledge_grounding = get_knowledge_grounding_prompt() if include_knowledge_grounding else ""
    safety_guardrails = get_safety_guardrails_prompt() if include_safety_guardrails else ""

    # Build the unified prompt
    unified_prompt = UNIFIED_PROMPT_TEMPLATE.format(
        course_name=course_name,
        level_info=level_info,
        duration_info=duration_info,
        agent_behavior=agent_behavior,
        pedagogical_framework=pedagogical_framework,
        course_specific_section=course_specific_section,
        tool_handling=tool_handling,
        knowledge_grounding=knowledge_grounding,
        safety_guardrails=safety_guardrails,
    )
    
    # Clean up any excessive whitespace from empty sections
    unified_prompt = re.sub(r'\n{4,}', '\n\n---\n\n', unified_prompt)
    unified_prompt = re.sub(r'---\s*---', '---', unified_prompt)
    
    return unified_prompt.strip()


def get_minimal_prompt(
    course_name: str,
    learning_prompt: Optional[str] = None,
) -> str:
    """
    Returns a minimal prompt for lightweight agent configurations.
    Only includes essential learning guidelines without full tool/safety sections.
    
    Args:
        course_name: Name of the course
        learning_prompt: Custom learning prompt from CACA
    
    Returns:
        Minimal prompt string
    """
    
    base = f"""# {course_name} - Course Assistant

You are an AI-powered educational assistant for "{course_name}".

{learning_prompt or "Help students learn and understand the course material. Be patient, clear, and encouraging."}

Always:
- Be helpful and supportive
- Explain concepts clearly
- Use the knowledge base as your primary source
- Format responses with proper Markdown
- Maintain academic integrity
"""
    return base.strip()
