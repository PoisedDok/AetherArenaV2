"""Conversation compaction system for aether-arena.

Provides automatic and manual conversation summarization to keep context
within model token limits, with circuit breaker, PTL retry, and a clean
boundary marker protocol for the frontend to render.
"""
