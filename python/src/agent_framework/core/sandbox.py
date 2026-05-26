from __future__ import annotations

import subprocess
from dataclasses import dataclass


@dataclass
class SandboxResult:
    stdout: str
    stderr: str
    exit_code: int


class LocalSandboxBackend:
    async def execute(self, command: str, *, cwd: str, timeout_ms: int) -> SandboxResult:
        del timeout_ms
        completed = subprocess.run(["bash", "-lc", command], cwd=cwd, capture_output=True, text=True, check=False)
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
