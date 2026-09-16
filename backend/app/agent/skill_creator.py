"""Autonomous skill creation from successful agent sessions.

After the agent completes a complex multi-step task, this module extracts
reusable patterns into skill definitions. Skills are stored both in the
memory database and as markdown files that can be loaded on startup.

Inspired by Hermes Agent's self-improving skill loop and compatible with
the agentskills.io open standard format.
"""

from __future__ import annotations

import json
import logging
import os
import re
import time
from pathlib import Path
from typing import Any, Dict, List, Optional

logger = logging.getLogger("agent.skill_creator")

# Where auto-generated skills are saved
_SKILLS_DIR = os.path.join(
    os.getenv("DATA_DIR", os.path.join(os.path.dirname(__file__), "..", "..", "data")),
    "skills", "auto",
)


def _ensure_skills_dir():
    os.makedirs(_SKILLS_DIR, exist_ok=True)


def _sanitize_name(name: str) -> str:
    """Turn a skill name into a safe filename."""
    safe = re.sub(r"[^\w\s-]", "", name.lower().strip())
    return re.sub(r"[\s]+", "_", safe)[:60]


class SkillDefinition:
    """A reusable skill extracted from an agent session."""

    def __init__(self, name: str, description: str, steps: List[str],
                 triggers: List[str], tags: Optional[List[str]] = None,
                 version: str = "1.0"):
        self.name = name
        self.description = description
        self.steps = steps
        self.triggers = triggers
        self.tags = tags or []
        self.version = version
        self.created_at = time.time()
        self.usage_count = 0

    def to_markdown(self) -> str:
        """Convert to agentskills.io compatible markdown format."""
        frontmatter = (
            f"---\n"
            f"name: \"{self.name}\"\n"
            f"description: \"{self.description}\"\n"
            f"version: \"{self.version}\"\n"
            f"triggers:\n"
        )
        for trigger in self.triggers:
            frontmatter += f"  - \"{trigger}\"\n"
        if self.tags:
            frontmatter += "tags:\n"
            for tag in self.tags:
                frontmatter += f"  - \"{tag}\"\n"
        frontmatter += "---\n\n"

        body = f"# {self.name}\n\n{self.description}\n\n## Steps\n\n"
        for i, step in enumerate(self.steps, 1):
            body += f"{i}. {step}\n"

        return frontmatter + body

    def to_dict(self) -> Dict[str, Any]:
        return {
            "name": self.name,
            "description": self.description,
            "steps": self.steps,
            "triggers": self.triggers,
            "tags": self.tags,
            "version": self.version,
            "created_at": self.created_at,
            "usage_count": self.usage_count,
        }

    @classmethod
    def from_dict(cls, data: Dict) -> "SkillDefinition":
        skill = cls(
            name=data["name"],
            description=data["description"],
            steps=data.get("steps", []),
            triggers=data.get("triggers", []),
            tags=data.get("tags", []),
            version=data.get("version", "1.0"),
        )
        skill.created_at = data.get("created_at", time.time())
        skill.usage_count = data.get("usage_count", 0)
        return skill


class SkillCreator:
    """Creates, saves, and manages auto-generated skills."""

    def __init__(self, skills_dir: str = ""):
        self.skills_dir = skills_dir or _SKILLS_DIR
        _ensure_skills_dir()

    def create_skill(self, name: str, description: str,
                     steps: List[str], triggers: List[str],
                     tags: Optional[List[str]] = None) -> SkillDefinition:
        """Create and save a new skill from agent experience."""
        skill = SkillDefinition(
            name=name, description=description,
            steps=steps, triggers=triggers, tags=tags,
        )

        # Save as markdown file
        filename = _sanitize_name(name) + ".md"
        filepath = os.path.join(self.skills_dir, filename)
        with open(filepath, "w", encoding="utf-8") as f:
            f.write(skill.to_markdown())
        skill.filepath = filepath

        # Also save to memory database
        from app.agent.memory import get_memory
        memory = get_memory()
        memory.save_skill(name, description, steps, triggers)
        memory.store(
            content=f"Learned skill: {name} — {description}",
            category="skill_created",
            metadata=skill.to_dict(),
            importance=5,
        )

        logger.info("Created skill: %s (%s)", name, filepath)
        return skill

    def improve_skill(self, name: str, feedback: str,
                      new_steps: Optional[List[str]] = None) -> Optional[SkillDefinition]:
        """Improve an existing skill based on usage feedback."""
        from app.agent.memory import get_memory
        memory = get_memory()

        existing = None
        for skill in memory.get_skills():
            if skill["name"] == name:
                existing = skill
                break

        if not existing:
            logger.warning("Skill %r not found for improvement", name)
            return None

        steps = new_steps or existing["steps"]
        description = existing["description"]
        if feedback:
            description += f" (Improved: {feedback})"

        # Bump version
        old_version = existing.get("version", "1.0")
        try:
            major, minor = old_version.split(".")
            new_version = f"{major}.{int(minor) + 1}"
        except (ValueError, AttributeError):
            new_version = "1.1"

        improved = SkillDefinition(
            name=name,
            description=description,
            steps=steps,
            triggers=existing.get("triggers", []),
            tags=existing.get("tags", []),
            version=new_version,
        )

        # Overwrite the file
        filename = _sanitize_name(name) + ".md"
        filepath = os.path.join(self.skills_dir, filename)
        with open(filepath, "w", encoding="utf-8") as f:
            f.write(improved.to_markdown())

        # Update in memory
        memory.save_skill(name, improved.description, steps, improved.triggers)
        memory.store(
            content=f"Improved skill: {name} v{new_version} — {feedback}",
            category="skill_improved",
            importance=3,
        )

        logger.info("Improved skill: %s → v%s", name, new_version)
        return improved

    def list_skills(self) -> List[Dict[str, Any]]:
        """List all auto-generated skills."""
        skills = []

        # From files
        if os.path.isdir(self.skills_dir):
            for filename in sorted(os.listdir(self.skills_dir)):
                if not filename.endswith(".md"):
                    continue
                filepath = os.path.join(self.skills_dir, filename)
                try:
                    text = Path(filepath).read_text(encoding="utf-8")
                    name, desc = self._parse_skill_header(text)
                    skills.append({
                        "name": name or filename[:-3],
                        "description": desc or "",
                        "file": filepath,
                        "source": "auto",
                    })
                except OSError:
                    continue

        # Deduplicate with memory DB skills
        from app.agent.memory import get_memory
        memory = get_memory()
        db_skills = memory.get_skills()
        seen_names = {s["name"] for s in skills}
        for skill in db_skills:
            if skill["name"] not in seen_names:
                skill["source"] = "memory"
                skills.append(skill)

        return skills

    def find_applicable_skills(self, user_message: str) -> List[Dict]:
        """Find skills that might apply to the user's current request."""
        from app.agent.memory import get_memory
        memory = get_memory()
        return memory.find_matching_skills(user_message)

    def get_skills_prompt_context(self, user_message: str = "") -> str:
        """Generate prompt context about available and matching skills."""
        all_skills = self.list_skills()
        if not all_skills:
            return ""

        lines = ["\n\nLEARNED SKILLS:"]
        matching = self.find_applicable_skills(user_message) if user_message else []

        if matching:
            lines.append("Skills relevant to this request:")
            for skill in matching[:3]:
                steps_text = " → ".join(skill.get("steps", [])[:5])
                lines.append(f"  • {skill['name']}: {steps_text}")

        lines.append(f"\nAll available skills ({len(all_skills)} total):")
        for skill in all_skills[:10]:
            lines.append(f"  - {skill['name']}: {skill.get('description', '')[:100]}")

        return "\n".join(lines)

    @staticmethod
    def _parse_skill_header(text: str):
        """Extract name and description from YAML frontmatter."""
        name = description = ""
        front = re.match(r"^---\s*\n(.*?)\n---", text, re.DOTALL)
        if front:
            for line in front.group(1).splitlines():
                key, _, value = line.partition(":")
                key = key.strip()
                value = value.strip().strip("\"'")
                if key == "name":
                    name = value
                elif key == "description":
                    description = value
        return name, description

    @staticmethod
    def extract_skill_from_session(task: str, steps_taken: int,
                                   tools_used: List[str],
                                   summary: str) -> Optional[Dict]:
        """Analyze a completed session and suggest a skill extraction.

        Returns a skill definition dict if the session was complex enough
        to warrant skill creation, None otherwise.
        """
        if steps_taken < 5 or len(set(tools_used)) < 3:
            return None

        # Infer triggers from the task description
        triggers = []
        task_lower = task.lower()
        trigger_patterns = [
            (r"deploy", "deploy"),
            (r"test", "run tests"),
            (r"fix\s+(?:bug|error|issue)", "fix bug"),
            (r"refactor", "refactor"),
            (r"create\s+(?:new|a)", "create"),
            (r"install|setup|configure", "setup"),
            (r"debug", "debug"),
            (r"build", "build"),
            (r"migrate", "migrate"),
            (r"update|upgrade", "update"),
        ]
        for pattern, trigger in trigger_patterns:
            if re.search(pattern, task_lower):
                triggers.append(trigger)

        if not triggers:
            triggers = [task_lower.split()[0] if task_lower.split() else "general"]

        return {
            "name": f"auto_{_sanitize_name(task[:40])}",
            "description": summary[:200] if summary else task[:200],
            "steps": [f"Used {tool}" for tool in dict.fromkeys(tools_used)],
            "triggers": triggers,
            "tags": ["auto-generated"],
        }


# Global instance
_creator: Optional[SkillCreator] = None


def get_skill_creator() -> SkillCreator:
    global _creator
    if _creator is None:
        _creator = SkillCreator()
    return _creator
