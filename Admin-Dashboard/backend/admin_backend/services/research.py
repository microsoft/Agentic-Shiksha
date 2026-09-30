import json
import logging
from typing import Any, Callable, Dict

from admin_backend.core.contracts import ResearchStorage
from admin_backend.core.log_safe import scrub
from admin_backend.services.research_json import parse_research_json

logger = logging.getLogger(__name__)


class ResearchService:
    def __init__(self, storage: ResearchStorage, respond: Callable[[str], str]) -> None:
        self.storage = storage
        self.respond = respond

    def run_institute(self, institute_name: str, instructions: str=''):
        """Background task: research an institute via institute-research-agent."""
        import time
        from datetime import datetime

        logger.info(f"[Institute Research] Starting research for '{institute_name}'")
        start_time = time.time()

        self.storage.save_institute_research(institute_name, {
            "status": "researching",
            "institute_name": institute_name,
            "started_at": datetime.utcnow().isoformat() + "Z",
        })

        research_prompt = (
            f"Research the following educational institute and return a structured JSON profile:\n\n"
            f"**Institute:** {institute_name}\n\n"
            f"This is a Type 1 (Institute Research) request. Research thoroughly — official website, NIRF data, "
            f"placement reports, student reviews, Wikipedia, department pages.\n\n"
            f"Return the JSON with EXACTLY these top-level keys and structure:\n"
            f"```json\n"
            f'{{\n'
            f'  "research_type": "institute",\n'
            f'  "profile": {{\n'
            f'    "name": "Full official institute name",\n'
            f'    "location": "City, State, Country",\n'
            f'    "type": "Public/Private, Autonomous/Affiliated, University/College",\n'
            f'    "established": "Year",\n'
            f'    "description": "2-3 sentence overview",\n'
            f'    "societal_commitments": "Community outreach, social responsibility initiatives, rural engagement, sustainability efforts, NSS/NCC activities",\n'
            f'    "website": "Official website URL"\n'
            f'  }},\n'
            f'  "academic_system": {{\n'
            f'    "curriculum_standards": "Credit system, semester structure, etc.",\n'
            f'    "exam_pattern": "Mid-sem, end-sem, assignments — typical weightages",\n'
            f'    "grading_system": "Grading scale (e.g., 10-point CGPA)",\n'
            f'    "attendance_policy": "Minimum attendance and consequences",\n'
            f'    "backlog_policy": "Re-examination and repeat course rules",\n'
            f'    "academic_calendar": "Typical semester dates, exam periods, breaks"\n'
            f'  }},\n'
            f'  "campus_life": {{\n'
            f'    "hostels": [{{"name": "Hostel Name", "description": "Capacity, amenities, culture, notable facts"}}],\n'
            f'    "student_clubs": [{{"name": "Club Name", "category": "Technical/Cultural/Sports", "description": "Activities and significance"}}],\n'
            f'    "library_resources": "Library facilities, digital access",\n'
            f'    "study_culture": "Typical study patterns",\n'
            f'    "food_and_facilities": "Canteens, mess, medical, sports facilities"\n'
            f'  }},\n'
            f'  "student_demographics": {{\n'
            f'    "typical_background": "Entrance exam, expected academic maturity",\n'
            f'    "batch_size": "Total intake per year and per department",\n'
            f'    "admission_process": "Entrance exams, cutoffs, reservation policies",\n'
            f'    "diversity": "Geographic, socioeconomic diversity patterns",\n'
            f'    "common_strengths": "What students typically excel at",\n'
            f'    "common_struggles": "Known weak areas students arrive with"\n'
            f'  }},\n'
            f'  "industry_connections": {{\n'
            f'    "alumni_network": "Notable alumni, alumni associations",\n'
            f'    "industry_collaborations": "MoUs, sponsored labs, joint research"\n'
            f'  }}\n'
            f'}}\n'
            f"```\n\n"
            f"IMPORTANT: hostels MUST be an array of objects with \"name\" and \"description\" keys "
            f"(include capacity, amenities, culture). student_clubs MUST be an array of objects with "
            f"\"name\", \"category\", and \"description\" keys. Return ONLY the JSON. No markdown fences, "
            f"no commentary, no text before or after."
        )
        if instructions and instructions.strip():
            research_prompt += f"\n\n**Additional Instructions from Admin:**\n{instructions.strip()}"

        raw_response = ""
        try:
            raw_response = self.respond(research_prompt)
            logger.info(f"[Institute Research] Got response ({len(raw_response)} chars): {raw_response[:200]}")

            research_data = parse_research_json(raw_response)
            research_data["status"] = "completed"
            research_data["institute_name"] = institute_name
            research_data["completed_at"] = datetime.utcnow().isoformat() + "Z"
            research_data["research_duration_seconds"] = round(time.time() - start_time, 1)

            self.storage.save_institute_research(institute_name, research_data)

            elapsed = time.time() - start_time
            logger.info(f"[Institute Research] Complete for '{institute_name}' in {elapsed:.1f}s")

        except json.JSONDecodeError as e:
            logger.error(f"[Institute Research] Failed to parse JSON: {e}. Raw response: {raw_response[:300]}")
            # Save the raw text response as a partial result instead of just "failed"
            self.storage.save_institute_research(institute_name, {
                "status": "failed",
                "institute_name": institute_name,
                "error": f"Agent returned non-JSON response: {raw_response[:200]}",
                "raw_response": raw_response[:500],
            })
        except Exception as e:
            logger.error(f"[Institute Research] Failed: {e}", exc_info=True)
            self.storage.save_institute_research(institute_name, {
                "status": "failed",
                "institute_name": institute_name,
                "error": "Research failed",
            })

    def run_department(self, institute_name: str, department_name: str, instructions: str=''):
        """Background task: research a department via institute-research-agent."""
        import time
        from datetime import datetime

        logger.info(f"[Department Research] Starting research for '{department_name}' at '{institute_name}'")
        start_time = time.time()

        self.storage.save_department_research(institute_name, department_name, {
            "status": "researching",
            "institute_name": institute_name,
            "department_name": department_name,
            "started_at": datetime.utcnow().isoformat() + "Z",
        })

        research_prompt = (
            f"Research the following department at an educational institute and return a structured JSON profile:\n\n"
            f"**Institute:** {institute_name}\n"
            f"**Department:** {department_name}\n\n"
            f"This is a Type 2 (Department Research) request. Research thoroughly — official department page, faculty lists, "
            f"lab pages, curriculum details, research output.\n\n"
            f"Return the JSON with EXACTLY these top-level keys and structure:\n"
            f"```json\n"
            f'{{\n'
            f'  "research_type": "department",\n'
            f'  "profile": {{\n'
            f'    "name": "Department Name",\n'
            f'    "institute": "Institute Name",\n'
            f'    "description": "Focus areas, strengths, reputation",\n'
            f'    "established": "Year the department was established",\n'
            f'    "hod_or_chair": "Current HoD name if findable"\n'
            f'  }},\n'
            f'  "faculty": {{\n'
            f'    "strength": "Approximate faculty count",\n'
            f'    "specializations": ["Area 1", "Area 2"],\n'
            f'    "notable_faculty": [{{"name": "Prof. Name", "specialization": "Area", "notable_work": "Key contributions"}}],\n'
            f'    "student_faculty_ratio": "Ratio if findable"\n'
            f'  }},\n'
            f'  "facilities": {{\n'
            f'    "labs": [{{"name": "Lab Name", "description": "Equipment, purpose, courses that use it"}}],\n'
            f'    "computing_resources": "Servers, GPU clusters, software licenses",\n'
            f'    "research_centers": [{{"name": "Center Name", "focus": "Research focus area"}}]\n'
            f'  }},\n'
            f'  "curriculum": {{\n'
            f'    "teaching_philosophy": "Theoretical vs practical emphasis",\n'
            f'    "core_courses": ["Course 1", "Course 2"],\n'
            f'    "elective_tracks": ["Specialization 1", "Specialization 2"],\n'
            f'    "project_requirements": "Capstone projects, mini-projects, thesis requirements",\n'
            f'    "industry_exposure": "Industrial visits, workshops, guest lectures"\n'
            f'  }},\n'
            f'  "research": {{\n'
            f'    "focus_areas": ["Area 1", "Area 2"],\n'
            f'    "funded_projects": "Active grants, sponsorships, government projects",\n'
            f'    "phd_program": "PhD intake, research output, notable theses"\n'
            f'  }}\n'
            f'}}\n'
            f"```\n\n"
            f"IMPORTANT: labs MUST be an array of objects with \"name\" and \"description\" keys. "
            f"notable_faculty MUST be an array of objects with \"name\", \"specialization\", and \"notable_work\" keys. "
            f"research_centers MUST be an array of objects with \"name\" and \"focus\" keys. "
            f"Return ONLY the JSON. No markdown fences, no commentary, no text before or after."
        )
        if instructions and instructions.strip():
            research_prompt += f"\n\n**Additional Instructions from Admin:**\n{instructions.strip()}"

        raw_response = ""
        try:
            raw_response = self.respond(research_prompt)
            logger.info(f"[Department Research] Got response ({len(raw_response)} chars): {raw_response[:200]}")

            research_data = parse_research_json(raw_response)
            research_data["status"] = "completed"
            research_data["institute_name"] = institute_name
            research_data["department_name"] = department_name
            research_data["completed_at"] = datetime.utcnow().isoformat() + "Z"
            research_data["research_duration_seconds"] = round(time.time() - start_time, 1)

            self.storage.save_department_research(institute_name, department_name, research_data)

            elapsed = time.time() - start_time
            logger.info(f"[Department Research] Complete for '{department_name}@{institute_name}' in {elapsed:.1f}s")

        except json.JSONDecodeError as e:
            logger.error(f"[Department Research] Failed to parse JSON: {e}. Raw response: {raw_response[:300]}")
            self.storage.save_department_research(institute_name, department_name, {
                "status": "failed",
                "institute_name": institute_name,
                "department_name": department_name,
                "error": f"Agent returned non-JSON response: {raw_response[:200]}",
                "raw_response": raw_response[:500],
            })
        except Exception as e:
            logger.error(f"[Department Research] Failed: {e}", exc_info=True)
            self.storage.save_department_research(institute_name, department_name, {
                "status": "failed",
                "institute_name": institute_name,
                "department_name": department_name,
                "error": "Research failed",
            })

    def bulk_status(self, payload: Dict[str, Any]):
        """
        Get research statuses for multiple institutes and departments in one call.

        Request body:
            items: [{ type: "institute"|"department", institute: str, department?: str }]

        Returns:
            statuses: { key: ResearchStatus }
        """
        items = payload.get("items", [])
        statuses: Dict[str, Any] = {}
        for item in items:
            t = item.get("type", "institute")
            inst = (item.get("institute") or "").strip()
            dept = (item.get("department") or "").strip()
            if not inst:
                continue
            if t == "department" and dept:
                key = f"{inst}::{dept}"
                data = self.storage.get_department_research(inst, dept)
            else:
                key = inst
                data = self.storage.get_institute_research(inst)
            statuses[key] = data or {"status": "not_started"}
        return {"statuses": statuses}

    def get_institute(self, name: str):
        """Get institute research status/results."""
        data = self.storage.get_institute_research(name.strip())
        if not data:
            return {"status": "not_started", "institute": name}
        return data

    def get_department(self, institute: str, department: str):
        """Get department research status/results."""
        data = self.storage.get_department_research(institute.strip(), department.strip())
        if not data:
            return {"status": "not_started", "institute": institute, "department": department}
        return data

    def cancel_institute(self, name: str):
        """Cancel an in-progress institute research."""
        from datetime import datetime
        existing = self.storage.get_institute_research(name.strip())
        if not existing or existing.get("status") != "researching":
            return {"status": existing.get("status", "not_started") if existing else "not_started", "institute": name}
        self.storage.save_institute_research(name.strip(), {
            "status": "cancelled",
            "institute_name": name.strip(),
            "cancelled_at": datetime.utcnow().isoformat() + "Z",
        })
        logger.info(f"Institute research cancelled for '{scrub(name)}'")
        return {"status": "cancelled", "institute": name}

    def cancel_department(self, institute: str, department: str):
        """Cancel an in-progress department research."""
        from datetime import datetime
        existing = self.storage.get_department_research(institute.strip(), department.strip())
        if not existing or existing.get("status") != "researching":
            return {"status": existing.get("status", "not_started") if existing else "not_started", "institute": institute, "department": department}
        self.storage.save_department_research(institute.strip(), department.strip(), {
            "status": "cancelled",
            "institute_name": institute.strip(),
            "department_name": department.strip(),
            "cancelled_at": datetime.utcnow().isoformat() + "Z",
        })
        logger.info(f"Department research cancelled for '{scrub(department)}@{scrub(institute)}'")
        return {"status": "cancelled", "institute": institute, "department": department}
