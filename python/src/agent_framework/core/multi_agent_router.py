from __future__ import annotations

from dataclasses import dataclass

from agent_framework.runtime import AgentRuntime


@dataclass
class AgentRouteRule:
    agent_id: str
    runtime: AgentRuntime
    channel: str | None = None
    session_prefix: str | None = None


class MultiAgentRouter:
    def __init__(self, routes: list[AgentRouteRule], fallback: AgentRuntime) -> None:
        self._routes = routes
        self._fallback = fallback

    def resolve(self, *, session_id: str, agent_id: str | None = None, channel: str | None = None) -> AgentRuntime:
        if agent_id:
            for route in self._routes:
                if route.agent_id == agent_id:
                    return route.runtime
        for route in self._routes:
            if route.channel and channel and route.channel == channel:
                return route.runtime
            if route.session_prefix and session_id.startswith(route.session_prefix):
                return route.runtime
        return self._fallback
