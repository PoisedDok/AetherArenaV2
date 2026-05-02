"""Test configuration for the backend test suite.

Sets up sys.path and pre-mocks modules that would cause circular import
issues when unit-testing lightweight config/registry code in isolation.
"""

import sys
from enum import Enum
from pathlib import Path
from unittest.mock import MagicMock

# Make 'app' and 'aether' importable from any working directory
sys.path.insert(0, str(Path(__file__).parent.parent))

# Break the circular import chain that exists in production code:
#   aether.subagents.__init__
#     -> .executor (SubagentExecutor, SubagentResult)
#       -> aether.agents.thread_state
#         -> aether.agents.__init__
#           -> lead_agent.agent
#             -> subagent_limit_middleware
#               -> aether.subagents.executor  <-- circular!
#
# By injecting a mock for aether.subagents.executor *before* any test module
# triggers the import, __init__.py's "from .executor import ..." succeeds
# immediately without running the real executor module.


class _SubagentStatus(Enum):
    """Real SubagentStatus values kept in the mock so router code can use them."""
    PENDING = "pending"
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"
    TIMED_OUT = "timed_out"
    CANCELLED = "cancelled"


_executor_mock = MagicMock()
_executor_mock.SubagentExecutor = MagicMock
_executor_mock.SubagentResult = MagicMock
_executor_mock.SubagentStatus = _SubagentStatus
_executor_mock.MAX_CONCURRENT_SUBAGENTS = 3
_executor_mock.get_background_task_result = MagicMock()
_executor_mock.cleanup_background_task = MagicMock()
_executor_mock.cancel_background_task = MagicMock(return_value=True)

sys.modules["aether.subagents.executor"] = _executor_mock
