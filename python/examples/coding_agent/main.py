import asyncio
import os
import sys

from agent_framework.cli.main import _runtime
from agent_framework.core.domain import AgentRunRequest


async def main() -> None:
    runtime = _runtime(os.getcwd(), os.environ.get("AGENT_PROVIDER", "mock"), os.environ.get("AGENT_MODEL", "gpt-4o-mini"))
    message = " ".join(sys.argv[1:]) or "List files in the workspace using tools."
    async for event in runtime.router.route(
        AgentRunRequest(session_id="coding-agent", input={"role": "user", "content": message}, mode="agent")
    ):
        if event.type == "assistant":
            print(event.delta, end="", flush=True)
    print()


if __name__ == "__main__":
    asyncio.run(main())
