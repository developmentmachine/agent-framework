from __future__ import annotations

import asyncio
import json
import subprocess
from dataclasses import dataclass


@dataclass
class SandboxResult:
    stdout: str
    stderr: str
    exit_code: int


class LocalSandboxBackend:
    async def execute(self, command: str, *, cwd: str, timeout_ms: int) -> SandboxResult:
        def _run() -> subprocess.CompletedProcess[str]:
            return subprocess.run(
                ["bash", "-lc", command],
                cwd=cwd,
                capture_output=True,
                text=True,
                check=False,
                timeout=max(timeout_ms / 1000, 0.001),
            )

        completed = await asyncio.to_thread(_run)
        return SandboxResult(stdout=completed.stdout, stderr=completed.stderr, exit_code=completed.returncode)


class WorktreeSandboxBackend(LocalSandboxBackend):
    def __init__(self, repo_root: str) -> None:
        self.repo_root = repo_root
        self.worktrees: dict[str, str] = {}

    async def create_worktree(self, name: str, directory: str) -> None:
        subprocess.run(
            ["git", "worktree", "add", "--detach", directory, "HEAD"],
            cwd=self.repo_root,
            check=False,
        )
        self.worktrees[name] = directory
