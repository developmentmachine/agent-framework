from __future__ import annotations

from pathlib import Path

from agent_framework.core.contracts import ContextEngine
from agent_framework.core.domain import AgentMode, Message


DEFAULT_CONTEXT_FILES = ["AGENTS.md", "SOUL.md", "TOOLS.md"]


class WorkspaceContextEngine(ContextEngine):
    def __init__(self, workspace_root: str, context_files: list[str] | None = None) -> None:
        self._workspace_root = Path(workspace_root)
        self._context_files = context_files or DEFAULT_CONTEXT_FILES

    async def build(self, session_id: str, mode: AgentMode, history: list[Message]) -> tuple[str, list[Message]]:
        del session_id
        sections = [_mode_prompt(mode)]
        for file_name in self._context_files:
            content = _read_optional(self._workspace_root / file_name)
            if content:
                sections.append(f"## {file_name}\n{content}")

        skills_dir = self._workspace_root / "skills"
        if skills_dir.exists():
            skill_sections = []
            for skill_dir in sorted(skills_dir.iterdir()):
                skill_file = skill_dir / "SKILL.md"
                if skill_file.exists():
                    skill_sections.append(f"### Skill: {skill_dir.name}\n{skill_file.read_text(encoding='utf-8')}")
            if skill_sections:
                sections.append("## Skills\n" + "\n\n".join(skill_sections))

        system_prompt = "\n\n".join(sections)
        messages = [Message(role="system", content=system_prompt), *[
            message for message in history if message.role != "system"
        ]]
        return system_prompt, messages


def _mode_prompt(mode: AgentMode) -> str:
    if mode == "plan":
        return "You are in plan mode. Produce detailed implementation plans before making changes."
    if mode == "ask":
        return "You are in ask mode. Answer questions without modifying files or running destructive commands."
    return "You are an autonomous coding agent. Use tools to inspect and modify the workspace safely."


def _read_optional(path: Path) -> str | None:
    try:
        return path.read_text(encoding="utf-8")
    except OSError:
        return None
