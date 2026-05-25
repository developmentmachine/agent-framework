from __future__ import annotations

import re
from dataclasses import dataclass

from agent_framework.core.domain import PermissionDecision


@dataclass
class PermissionRule:
    tool_name: str
    decision: PermissionDecision
    pattern: re.Pattern[str] | None = None


DEFAULT_CODING_POLICY_RULES = [
    PermissionRule("shell", "deny", re.compile(r"rm\s+-rf\s+/")),
    PermissionRule("shell", "ask", re.compile(r"sudo\s+")),
    PermissionRule("write_file", "allow"),
    PermissionRule("read_file", "allow"),
    PermissionRule("grep", "allow"),
    PermissionRule("glob", "allow"),
]


class DefaultPermissionPolicy:
    def __init__(self, rules: list[PermissionRule] | None = None) -> None:
        self._rules = rules or DEFAULT_CODING_POLICY_RULES

    async def check(self, tool_name: str, arguments: dict, session_id: str) -> PermissionDecision:
        del session_id
        for rule in self._rules:
            if rule.tool_name not in ("*", tool_name):
                continue
            if rule.pattern and tool_name == "shell":
                command = str(arguments.get("command", ""))
                if rule.pattern.search(command):
                    return rule.decision
                continue
            if rule.tool_name in (tool_name, "*"):
                return rule.decision
        return "allow"
