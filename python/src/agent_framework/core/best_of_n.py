from __future__ import annotations

from dataclasses import dataclass

from agent_framework.core.domain import AgentRunRequest
from agent_framework.runtime import AgentRuntime


@dataclass
class BestOfNCandidate:
    id: str
    runtime: AgentRuntime


class BestOfNOrchestrator:
    async def run(self, request: AgentRunRequest, candidates: list[BestOfNCandidate]):
        results = []
        for candidate in candidates:
            events = []
            async for event in candidate.runtime.router.route(
                AgentRunRequest(
                    session_id=f"{request.session_id}:{candidate.id}",
                    input=request.input,
                    mode=request.mode,
                )
            ):
                events.append(event)
            score = sum(5 for event in events if event.type == "assistant")
            score -= sum(10 for event in events if event.type == "tool" and event.status == "error")
            results.append({"id": candidate.id, "events": events, "score": score})
        winner = max(results, key=lambda item: item["score"]) if results else None
        return {"winner_id": winner["id"] if winner else None, "candidates": results}
