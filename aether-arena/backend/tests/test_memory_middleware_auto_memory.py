"""Tests for MemoryMiddleware client context gate (auto_memory)."""

from unittest.mock import MagicMock, patch

from langchain_core.messages import AIMessage, HumanMessage
from langgraph.runtime import Runtime

from aether.agents.middlewares.memory_middleware import MemoryMiddleware
from aether.config.memory_config import MemoryConfig


def _conversation_state() -> dict:
    return {
        "messages": [
            HumanMessage(content="What is 2+2?"),
            AIMessage(content="Four."),
        ],
    }


class TestMemoryMiddlewareAutoMemory:
    def test_skips_queue_when_auto_memory_is_false(self) -> None:
        middleware = MemoryMiddleware()
        state = _conversation_state()
        runtime = Runtime(
            context={
                "thread_id": "thread-auto-memory-off",
                "auto_memory": False,
            },
        )
        mock_queue = MagicMock()
        with patch(
            "deerflow.agents.middlewares.memory_middleware.get_memory_config",
            return_value=MemoryConfig(enabled=True),
        ):
            with patch(
                "deerflow.agents.middlewares.memory_middleware.get_memory_queue",
                return_value=mock_queue,
            ):
                result = middleware.after_agent(state, runtime)

        assert result is None
        mock_queue.add.assert_not_called()

    def test_queues_when_auto_memory_is_true(self) -> None:
        middleware = MemoryMiddleware()
        state = _conversation_state()
        runtime = Runtime(
            context={
                "thread_id": "thread-auto-memory-on",
                "auto_memory": True,
            },
        )
        mock_queue = MagicMock()
        with patch(
            "deerflow.agents.middlewares.memory_middleware.get_memory_config",
            return_value=MemoryConfig(enabled=True),
        ):
            with patch(
                "deerflow.agents.middlewares.memory_middleware.get_memory_queue",
                return_value=mock_queue,
            ):
                result = middleware.after_agent(state, runtime)

        assert result is None
        mock_queue.add.assert_called_once()
        call_kw = mock_queue.add.call_args.kwargs
        assert call_kw["thread_id"] == "thread-auto-memory-on"
        assert call_kw["agent_name"] is None

    def test_queues_when_auto_memory_key_absent(self) -> None:
        """Older clients omit auto_memory; behavior must stay enabled."""
        middleware = MemoryMiddleware(agent_name="my-agent")
        state = _conversation_state()
        runtime = Runtime(context={"thread_id": "thread-legacy-client"})
        mock_queue = MagicMock()
        with patch(
            "deerflow.agents.middlewares.memory_middleware.get_memory_config",
            return_value=MemoryConfig(enabled=True),
        ):
            with patch(
                "deerflow.agents.middlewares.memory_middleware.get_memory_queue",
                return_value=mock_queue,
            ):
                result = middleware.after_agent(state, runtime)

        assert result is None
        mock_queue.add.assert_called_once()
        assert mock_queue.add.call_args.kwargs["agent_name"] == "my-agent"
