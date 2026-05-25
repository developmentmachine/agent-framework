from __future__ import annotations

import json
import re
import subprocess
from pathlib import Path

from pydantic import BaseModel

from agent_framework.core.domain import ToolDefinition, ToolExecutionContext
from agent_framework.core.tool_registry import create_pydantic_tool


class ReadFileArgs(BaseModel):
    path: str


class WriteFileArgs(BaseModel):
    path: str
    content: str


class GlobArgs(BaseModel):
    pattern: str


class GrepArgs(BaseModel):
    pattern: str
    path: str | None = None


class ShellArgs(BaseModel):
    command: str


def _resolve(workspace_root: str, target: str) -> Path:
    root = Path(workspace_root).resolve()
    resolved = (root / target).resolve()
    if not str(resolved).startswith(str(root)):
        raise ValueError("Path escapes workspace root")
    return resolved


def _walk_files(root: Path, pattern: str) -> list[str]:
    results: list[str] = []
    for path in sorted(root.rglob("*")):
        if any(part in {".git", "node_modules"} for part in path.parts):
            continue
        if path.is_file() and (not pattern or pattern in path.name):
            results.append(str(path))
    return results


def register_builtin_tools(registry) -> None:
    for tool in create_builtin_tools():
        registry.register(tool)


def create_builtin_tools():
    async def read_file(args: ReadFileArgs, ctx: ToolExecutionContext):
        return _resolve(ctx.workspace_root, args.path).read_text(encoding="utf-8")

    async def write_file(args: WriteFileArgs, ctx: ToolExecutionContext):
        target = _resolve(ctx.workspace_root, args.path)
        target.write_text(args.content, encoding="utf-8")
        return f"Wrote {args.path}"

    async def glob_files(args: GlobArgs, ctx: ToolExecutionContext):
        root = Path(ctx.workspace_root)
        return _walk_files(root, args.pattern)[:100]

    async def grep_files(args: GrepArgs, ctx: ToolExecutionContext):
        root = _resolve(ctx.workspace_root, args.path) if args.path else Path(ctx.workspace_root)
        regex = re.compile(args.pattern, re.IGNORECASE)
        hits: list[str] = []
        for file_path in _walk_files(root, ""):
            try:
                lines = Path(file_path).read_text(encoding="utf-8").splitlines()
            except OSError:
                continue
            for index, line in enumerate(lines, start=1):
                if regex.search(line):
                    rel = Path(file_path).relative_to(ctx.workspace_root)
                    hits.append(f"{rel}:{index}:{line}")
            if len(hits) >= 100:
                break
        return hits

    async def shell_exec(args: ShellArgs, ctx: ToolExecutionContext):
        completed = subprocess.run(
            ["bash", "-lc", args.command],
            cwd=ctx.workspace_root,
            capture_output=True,
            text=True,
            check=False,
        )
        output = completed.stdout
        if completed.stderr:
            output = f"{output}\n{completed.stderr}".strip()
        return output

    def wrap(fn):
        async def runner(model, ctx: ToolExecutionContext | None = None):
            del ctx
            return await fn(model, ctx)

        return runner

    return [
        create_pydantic_tool(
            ToolDefinition(
                name="read_file",
                description="Read a UTF-8 text file from the workspace",
                parameters={"type": "object", "properties": {"path": {"type": "string"}}, "required": ["path"]},
            ),
            ReadFileArgs,
            lambda args, ctx: read_file(args, ctx),
        ),
        create_pydantic_tool(
            ToolDefinition(
                name="write_file",
                description="Write UTF-8 text to a file in the workspace",
                parameters={
                    "type": "object",
                    "properties": {"path": {"type": "string"}, "content": {"type": "string"}},
                    "required": ["path", "content"],
                },
            ),
            WriteFileArgs,
            lambda args, ctx: write_file(args, ctx),
        ),
        create_pydantic_tool(
            ToolDefinition(
                name="glob",
                description="Find files by filename substring within workspace",
                parameters={"type": "object", "properties": {"pattern": {"type": "string"}}, "required": ["pattern"]},
            ),
            GlobArgs,
            lambda args, ctx: glob_files(args, ctx),
        ),
        create_pydantic_tool(
            ToolDefinition(
                name="grep",
                description="Search file contents for a regex pattern",
                parameters={
                    "type": "object",
                    "properties": {"pattern": {"type": "string"}, "path": {"type": "string"}},
                    "required": ["pattern"],
                },
            ),
            GrepArgs,
            lambda args, ctx: grep_files(args, ctx),
        ),
        create_pydantic_tool(
            ToolDefinition(
                name="shell",
                description="Execute a shell command in the workspace",
                parameters={"type": "object", "properties": {"command": {"type": "string"}}, "required": ["command"]},
                concurrency="serial",
            ),
            ShellArgs,
            lambda args, ctx: shell_exec(args, ctx),
        ),
    ]
