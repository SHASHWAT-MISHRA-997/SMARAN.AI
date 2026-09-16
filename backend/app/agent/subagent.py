"""Subagent spawning and parallel task coordination.

Hermes delegates work to isolated subagents that run in parallel. Each
subagent gets its own conversation context, a scoped subset of tools, and
a step budget inherited from the parent. Results are collected and merged
back into the parent's context.

This integrates with the existing orchestrator for graph-level parallelism
while adding agent-initiated delegation (the agent decides to spawn helpers
rather than the orchestrator decomposing upfront).
"""

from __future__ import annotations

import asyncio
import logging
import time
import uuid
from dataclasses import dataclass, field
from typing import Any, AsyncIterator, Dict, List, Optional, Set

logger = logging.getLogger("agent.subagent")

#: Maximum concurrent subagents per parent
MAX_CONCURRENT_SUBAGENTS = 4

#: Maximum depth of subagent nesting
MAX_NESTING_DEPTH = 3


class SubagentError(RuntimeError):
    """A subagent that could not be created or that failed."""


@dataclass
class SubagentTask:
    """A task delegated to a subagent."""
    id: str
    instruction: str
    parent_id: str
    tools_allowed: Set[str]
    step_budget: int
    status: str = "pending"  # pending, running, done, failed
    result: Optional[str] = None
    steps_used: int = 0
    tools_used: List[str] = field(default_factory=list)
    created_at: float = field(default_factory=time.time)
    completed_at: Optional[float] = None
    error: Optional[str] = None


class SubagentManager:
    """Manages subagent lifecycle and coordinates parallel execution."""

    def __init__(self):
        self._tasks: Dict[str, SubagentTask] = {}
        self._active_count: Dict[str, int] = {}  # parent_id -> active count
        self._nesting_depth: Dict[str, int] = {}  # task_id -> depth

    def create_subagent(self, instruction: str, parent_id: str = "root",
                        tools_allowed: Optional[Set[str]] = None,
                        step_budget: int = 12,
                        depth: int = 0) -> SubagentTask:
        """Create a new subagent task."""
        # Enforce limits
        active = self._active_count.get(parent_id, 0)
        if active >= MAX_CONCURRENT_SUBAGENTS:
            raise SubagentError(
                f"Too many active subagents ({active}). "
                f"Wait for one to finish before spawning another.")

        if depth >= MAX_NESTING_DEPTH:
            raise SubagentError(
                f"Subagent nesting depth {depth} exceeds maximum "
                f"({MAX_NESTING_DEPTH}). Simplify the task instead.")

        # Default: all non-mutating tools + write_file, edit_file
        if tools_allowed is None:
            tools_allowed = {
                "list_files", "read_file", "search", "write_file",
                "edit_file", "run_command",
            }

        task = SubagentTask(
            id=f"sub_{uuid.uuid4().hex[:8]}",
            instruction=instruction,
            parent_id=parent_id,
            tools_allowed=tools_allowed,
            step_budget=step_budget,
        )

        self._tasks[task.id] = task
        self._active_count[parent_id] = active + 1
        self._nesting_depth[task.id] = depth

        logger.info("Created subagent %s for parent %s: %s",
                     task.id, parent_id, instruction[:80])
        return task

    async def run_subagent(self, task: SubagentTask,
                           model: str = "", provider: str = "",
                           api_key: str = "",
                           root: str = "") -> AsyncIterator[Dict]:
        """Run a subagent and yield its events."""
        from app.agent import tools as toolbox
        from app.agent.loop import parse_tool_call, SYSTEM, MAX_STEPS

        task.status = "running"

        try:
            workspace = toolbox.workspace_for(root)
        except toolbox.ToolError as exc:
            task.status = "failed"
            task.error = str(exc)
            yield {"type": "error", "subagent_id": task.id, "message": str(exc)}
            return

        # Build scoped tool descriptions
        scoped_tools = {
            name: entry for name, entry in toolbox.TOOLS.items()
            if name in task.tools_allowed
        }

        tool_lines = []
        for name, (_, args, description) in scoped_tools.items():
            tool_lines.append("- %s(%s): %s" % (name, ", ".join(args), description))
        tools_desc = "\n".join(tool_lines)

        system_prompt = (
            f"You are a SUBAGENT of SMARAN.AI, working on a specific subtask.\n"
            f"Your parent agent has delegated this work to you.\n\n"
            f"RULES:\n"
            f"- Focus ONLY on the specific instruction below.\n"
            f"- Do NOT start new tasks or deviate from the instruction.\n"
            f"- Report your results concisely when done.\n"
            f"- You have a budget of {task.step_budget} steps.\n\n"
            f"Available tools:\n{tools_desc}\n\n"
            f"To use a tool, emit exactly this:\n"
            f"<tool_call name=\"tool_name\">\n"
            f"<arg>value</arg>\n"
            f"</tool_call>\n\n"
            f"When done, reply normally with a summary of what you accomplished."
        )

        messages = [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": task.instruction},
        ]

        effective_budget = min(task.step_budget, MAX_STEPS)

        for step in range(1, effective_budget + 1):
            try:
                from app.agent.loop import _ask_model
                reply = await _ask_model(messages, model, provider, api_key)
            except Exception as exc:
                task.status = "failed"
                task.error = str(exc)
                yield {"type": "error", "subagent_id": task.id, "message": str(exc)}
                return

            call = parse_tool_call(reply)

            if call is None:
                # Subagent considers work finished
                task.status = "done"
                task.result = reply
                task.steps_used = step
                task.completed_at = time.time()
                yield {
                    "type": "subagent_done",
                    "subagent_id": task.id,
                    "result": reply,
                    "steps": step,
                    "tools_used": task.tools_used,
                }
                self._cleanup(task)
                return

            # Verify tool is allowed
            if call["name"] not in task.tools_allowed:
                messages.append({"role": "assistant", "content": reply})
                messages.append({
                    "role": "user",
                    "content": f"Tool '{call['name']}' is not available to you. "
                               f"Available: {', '.join(sorted(task.tools_allowed))}",
                })
                continue

            yield {
                "type": "subagent_tool_call",
                "subagent_id": task.id,
                "name": call["name"],
                "step": step,
            }

            # Execute through the standard tool system
            result = toolbox.execute(call["name"], call["arguments"], workspace)
            task.tools_used.append(call["name"])
            task.steps_used = step

            messages.append({"role": "assistant", "content": reply})
            messages.append({
                "role": "user",
                "content": "Result of %s:\n%s" % (call["name"], result),
            })

        # Ran out of steps
        task.status = "done"
        task.result = f"Reached step limit ({effective_budget}). Work done so far has been applied."
        task.completed_at = time.time()
        yield {
            "type": "subagent_done",
            "subagent_id": task.id,
            "result": task.result,
            "steps": effective_budget,
            "tools_used": task.tools_used,
            "budget_exhausted": True,
        }
        self._cleanup(task)

    async def run_parallel(self, tasks: List[SubagentTask],
                           model: str = "", provider: str = "",
                           api_key: str = "",
                           root: str = "") -> List[Dict]:
        """Run multiple subagents in parallel and collect results."""
        results: List[Dict] = []

        async def _collect(task: SubagentTask):
            events = []
            async for event in self.run_subagent(task, model, provider, api_key, root):
                events.append(event)
            return events

        gathered = await asyncio.gather(
            *[_collect(task) for task in tasks],
            return_exceptions=True,
        )

        for i, result in enumerate(gathered):
            if isinstance(result, Exception):
                results.append({
                    "subagent_id": tasks[i].id,
                    "status": "failed",
                    "error": str(result),
                })
            else:
                # Find the done event
                done_event = None
                for event in result:
                    if event.get("type") in ("subagent_done", "error"):
                        done_event = event
                results.append(done_event or {
                    "subagent_id": tasks[i].id,
                    "status": "unknown",
                })

        return results

    def get_task(self, task_id: str) -> Optional[SubagentTask]:
        return self._tasks.get(task_id)

    def get_active_tasks(self, parent_id: str = "") -> List[SubagentTask]:
        tasks = list(self._tasks.values())
        if parent_id:
            tasks = [t for t in tasks if t.parent_id == parent_id]
        return [t for t in tasks if t.status in ("pending", "running")]

    def cancel_task(self, task_id: str) -> bool:
        task = self._tasks.get(task_id)
        if task and task.status in ("pending", "running"):
            task.status = "failed"
            task.error = "Cancelled by parent"
            task.completed_at = time.time()
            self._cleanup(task)
            return True
        return False

    def _cleanup(self, task: SubagentTask):
        """Decrement active count for the parent."""
        count = self._active_count.get(task.parent_id, 1)
        self._active_count[task.parent_id] = max(0, count - 1)

    def format_results_for_parent(self, results: List[Dict]) -> str:
        """Format subagent results as context for the parent agent."""
        lines = ["\n--- SUBAGENT RESULTS ---"]
        for result in results:
            sub_id = result.get("subagent_id", "unknown")
            if result.get("status") == "failed" or result.get("type") == "error":
                lines.append(f"\n[{sub_id}] FAILED: {result.get('error', 'Unknown error')}")
            else:
                text = result.get("result", "No result")
                steps = result.get("steps", "?")
                lines.append(f"\n[{sub_id}] COMPLETED ({steps} steps):\n{text[:1500]}")
        lines.append("\n--- END SUBAGENT RESULTS ---")
        return "\n".join(lines)


# Global instance
_manager: Optional[SubagentManager] = None


def get_subagent_manager() -> SubagentManager:
    global _manager
    if _manager is None:
        _manager = SubagentManager()
    return _manager
