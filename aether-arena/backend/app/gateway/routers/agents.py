"""CRUD API for custom agents."""

import logging
import re
import shutil

import yaml
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from aether.config.agents_config import AgentConfig, list_custom_agents, load_agent_config, load_agent_soul
from aether.config.app_config import get_app_config
from aether.config.extensions_config import ExtensionsConfig, get_extensions_config, reload_extensions_config
from aether.config.paths import get_paths

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api", tags=["agents"])

AGENT_NAME_PATTERN = re.compile(r"^[A-Za-z0-9-]+$")


class AgentResponse(BaseModel):
    """Response model for a custom agent."""

    name: str = Field(..., description="Agent name (hyphen-case)")
    description: str = Field(default="", description="Agent description")
    model: str | None = Field(default=None, description="Optional model override")
    tool_groups: list[str] | None = Field(default=None, description="Optional tool group whitelist")
    soul: str | None = Field(default=None, description="SOUL.md content (included on GET /{name})")


class AgentsListResponse(BaseModel):
    """Response model for listing all custom agents."""

    agents: list[AgentResponse]


class AgentCreateRequest(BaseModel):
    """Request body for creating a custom agent."""

    name: str = Field(..., description="Agent name (must match ^[A-Za-z0-9-]+$, stored as lowercase)")
    description: str = Field(default="", description="Agent description")
    model: str | None = Field(default=None, description="Optional model override")
    tool_groups: list[str] | None = Field(default=None, description="Optional tool group whitelist")
    soul: str = Field(default="", description="SOUL.md content — agent personality and behavioral guardrails")


class AgentUpdateRequest(BaseModel):
    """Request body for updating a custom agent."""

    description: str | None = Field(default=None, description="Updated description")
    model: str | None = Field(default=None, description="Updated model override")
    tool_groups: list[str] | None = Field(default=None, description="Updated tool group whitelist")
    soul: str | None = Field(default=None, description="Updated SOUL.md content")


def _validate_agent_name(name: str) -> None:
    """Validate agent name against allowed pattern.

    Args:
        name: The agent name to validate.

    Raises:
        HTTPException: 422 if the name is invalid.
    """
    if not AGENT_NAME_PATTERN.match(name):
        raise HTTPException(
            status_code=422,
            detail=f"Invalid agent name '{name}'. Must match ^[A-Za-z0-9-]+$ (letters, digits, and hyphens only).",
        )


def _normalize_agent_name(name: str) -> str:
    """Normalize agent name to lowercase for filesystem storage."""
    return name.lower()


def _agent_config_to_response(agent_cfg: AgentConfig, include_soul: bool = False) -> AgentResponse:
    """Convert AgentConfig to AgentResponse."""
    soul: str | None = None
    if include_soul:
        soul = load_agent_soul(agent_cfg.name) or ""

    return AgentResponse(
        name=agent_cfg.name,
        description=agent_cfg.description,
        model=agent_cfg.model,
        tool_groups=agent_cfg.tool_groups,
        soul=soul,
    )


class ToolGroupResponse(BaseModel):
    """A single named tool group from config.yaml with its enabled state."""

    name: str = Field(..., description="Tool group name (e.g. 'web', 'bash', 'file:read')")
    enabled: bool = Field(default=True, description="Whether this tool group is enabled")


class ToolGroupsListResponse(BaseModel):
    """Response model for listing all configured tool groups."""

    tool_groups: list[ToolGroupResponse]


class ToolGroupUpdateRequest(BaseModel):
    """Request body for updating a tool group's enabled state."""

    enabled: bool = Field(..., description="Whether this tool group should be enabled")


@router.get(
    "/tool-groups",
    response_model=ToolGroupsListResponse,
    summary="List Tool Groups",
    description="List all tool groups defined in config.yaml with their enabled state.",
)
async def list_tool_groups() -> ToolGroupsListResponse:
    """Return all tool groups from the application config with their enabled state."""
    try:
        cfg = get_app_config()
        ext = get_extensions_config()
        return ToolGroupsListResponse(
            tool_groups=[
                ToolGroupResponse(name=g.name, enabled=ext.is_tool_group_enabled(g.name))
                for g in cfg.tool_groups
            ]
        )
    except Exception as e:
        logger.error(f"Failed to list tool groups: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Failed to list tool groups: {str(e)}")


@router.put(
    "/tool-groups/{name}",
    response_model=ToolGroupResponse,
    summary="Update Tool Group",
    description="Enable or disable a tool group. State is persisted to extensions_config.json.",
)
async def update_tool_group(name: str, request: ToolGroupUpdateRequest) -> ToolGroupResponse:
    """Enable or disable a named tool group.

    Args:
        name: The tool group name.
        request: The update request.

    Returns:
        The updated tool group response.

    Raises:
        HTTPException: 404 if tool group not found in config.yaml.
    """
    try:
        cfg = get_app_config()
        group_names = {g.name for g in cfg.tool_groups}
        if name not in group_names:
            raise HTTPException(status_code=404, detail=f"Tool group '{name}' not found")

        config_path = ExtensionsConfig.resolve_config_path()
        if config_path is None:
            import json
            from pathlib import Path
            config_path = Path.cwd().parent / "extensions_config.json"

        current = get_extensions_config()

        import json
        config_data = {
            "mcpServers": {n: s.model_dump() for n, s in current.mcp_servers.items()},
            "skills": {n: {"enabled": s.enabled} for n, s in current.skills.items()},
            "toolGroups": {n: {"enabled": s.enabled} for n, s in current.tool_groups.items()},
        }
        config_data["toolGroups"][name] = {"enabled": request.enabled}

        with open(config_path, "w", encoding="utf-8") as f:
            json.dump(config_data, f, indent=2)

        reload_extensions_config()
        return ToolGroupResponse(name=name, enabled=request.enabled)

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to update tool group '{name}': {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Failed to update tool group: {str(e)}")


@router.get(
    "/agents",
    response_model=AgentsListResponse,
    summary="List Custom Agents",
    description="List all custom agents available in the agents directory.",
)
async def list_agents() -> AgentsListResponse:
    """List all custom agents.

    Returns:
        List of all custom agents with their metadata (without soul content).
    """
    try:
        agents = list_custom_agents()
        return AgentsListResponse(agents=[_agent_config_to_response(a) for a in agents])
    except Exception as e:
        logger.error(f"Failed to list agents: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Failed to list agents: {str(e)}")


@router.get(
    "/agents/check",
    summary="Check Agent Name",
    description="Validate an agent name and check if it is available (case-insensitive).",
)
async def check_agent_name(name: str) -> dict:
    """Check whether an agent name is valid and not yet taken.

    Args:
        name: The agent name to check.

    Returns:
        ``{"available": true/false, "name": "<normalized>"}``

    Raises:
        HTTPException: 422 if the name is invalid.
    """
    _validate_agent_name(name)
    normalized = _normalize_agent_name(name)
    available = not get_paths().agent_dir(normalized).exists()
    return {"available": available, "name": normalized}


@router.get(
    "/agents/{name}",
    response_model=AgentResponse,
    summary="Get Custom Agent",
    description="Retrieve details and SOUL.md content for a specific custom agent.",
)
async def get_agent(name: str) -> AgentResponse:
    """Get a specific custom agent by name.

    Args:
        name: The agent name.

    Returns:
        Agent details including SOUL.md content.

    Raises:
        HTTPException: 404 if agent not found.
    """
    _validate_agent_name(name)
    name = _normalize_agent_name(name)

    try:
        agent_cfg = load_agent_config(name)
        return _agent_config_to_response(agent_cfg, include_soul=True)
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail=f"Agent '{name}' not found")
    except Exception as e:
        logger.error(f"Failed to get agent '{name}': {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Failed to get agent: {str(e)}")


@router.post(
    "/agents",
    response_model=AgentResponse,
    status_code=201,
    summary="Create Custom Agent",
    description="Create a new custom agent with its config and SOUL.md.",
)
async def create_agent_endpoint(request: AgentCreateRequest) -> AgentResponse:
    """Create a new custom agent.

    Args:
        request: The agent creation request.

    Returns:
        The created agent details.

    Raises:
        HTTPException: 409 if agent already exists, 422 if name is invalid.
    """
    _validate_agent_name(request.name)
    normalized_name = _normalize_agent_name(request.name)

    agent_dir = get_paths().agent_dir(normalized_name)

    if agent_dir.exists():
        raise HTTPException(status_code=409, detail=f"Agent '{normalized_name}' already exists")

    try:
        agent_dir.mkdir(parents=True, exist_ok=True)

        # Write config.yaml
        config_data: dict = {"name": normalized_name}
        if request.description:
            config_data["description"] = request.description
        if request.model is not None:
            config_data["model"] = request.model
        if request.tool_groups is not None:
            config_data["tool_groups"] = request.tool_groups

        config_file = agent_dir / "config.yaml"
        with open(config_file, "w", encoding="utf-8") as f:
            yaml.dump(config_data, f, default_flow_style=False, allow_unicode=True)

        # Write SOUL.md
        soul_file = agent_dir / "SOUL.md"
        soul_file.write_text(request.soul, encoding="utf-8")

        logger.info(f"Created agent '{normalized_name}' at {agent_dir}")

        agent_cfg = load_agent_config(normalized_name)
        return _agent_config_to_response(agent_cfg, include_soul=True)

    except HTTPException:
        raise
    except Exception as e:
        # Clean up on failure
        if agent_dir.exists():
            shutil.rmtree(agent_dir)
        logger.error(f"Failed to create agent '{request.name}': {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Failed to create agent: {str(e)}")


@router.put(
    "/agents/{name}",
    response_model=AgentResponse,
    summary="Update Custom Agent",
    description="Update an existing custom agent's config and/or SOUL.md.",
)
async def update_agent(name: str, request: AgentUpdateRequest) -> AgentResponse:
    """Update an existing custom agent.

    Args:
        name: The agent name.
        request: The update request (all fields optional).

    Returns:
        The updated agent details.

    Raises:
        HTTPException: 404 if agent not found.
    """
    _validate_agent_name(name)
    name = _normalize_agent_name(name)

    try:
        agent_cfg = load_agent_config(name)
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail=f"Agent '{name}' not found")

    agent_dir = get_paths().agent_dir(name)

    try:
        # Update config if any config fields changed
        config_changed = any(v is not None for v in [request.description, request.model, request.tool_groups])

        if config_changed:
            updated: dict = {
                "name": agent_cfg.name,
                "description": request.description if request.description is not None else agent_cfg.description,
            }
            new_model = request.model if request.model is not None else agent_cfg.model
            if new_model is not None:
                updated["model"] = new_model

            new_tool_groups = request.tool_groups if request.tool_groups is not None else agent_cfg.tool_groups
            if new_tool_groups is not None:
                updated["tool_groups"] = new_tool_groups

            config_file = agent_dir / "config.yaml"
            with open(config_file, "w", encoding="utf-8") as f:
                yaml.dump(updated, f, default_flow_style=False, allow_unicode=True)

        # Update SOUL.md if provided
        if request.soul is not None:
            soul_path = agent_dir / "SOUL.md"
            soul_path.write_text(request.soul, encoding="utf-8")

        logger.info(f"Updated agent '{name}'")

        refreshed_cfg = load_agent_config(name)
        return _agent_config_to_response(refreshed_cfg, include_soul=True)

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to update agent '{name}': {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Failed to update agent: {str(e)}")


class UserProfileResponse(BaseModel):
    """Response model for the global user profile (USER.md)."""

    content: str | None = Field(default=None, description="USER.md content, or null if not yet created")


class UserProfileUpdateRequest(BaseModel):
    """Request body for setting the global user profile."""

    content: str = Field(default="", description="USER.md content — describes the user's background and preferences")


@router.get(
    "/user-profile",
    response_model=UserProfileResponse,
    summary="Get User Profile",
    description="Read the global USER.md file that is injected into all custom agents.",
)
async def get_user_profile() -> UserProfileResponse:
    """Return the current USER.md content.

    Returns:
        UserProfileResponse with content=None if USER.md does not exist yet.
    """
    try:
        user_md_path = get_paths().user_md_file
        if not user_md_path.exists():
            return UserProfileResponse(content=None)
        raw = user_md_path.read_text(encoding="utf-8").strip()
        return UserProfileResponse(content=raw or None)
    except Exception as e:
        logger.error(f"Failed to read user profile: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Failed to read user profile: {str(e)}")


@router.put(
    "/user-profile",
    response_model=UserProfileResponse,
    summary="Update User Profile",
    description="Write the global USER.md file that is injected into all custom agents.",
)
async def update_user_profile(request: UserProfileUpdateRequest) -> UserProfileResponse:
    """Create or overwrite the global USER.md.

    Args:
        request: The update request with the new USER.md content.

    Returns:
        UserProfileResponse with the saved content.
    """
    try:
        paths = get_paths()
        paths.base_dir.mkdir(parents=True, exist_ok=True)
        paths.user_md_file.write_text(request.content, encoding="utf-8")
        logger.info(f"Updated USER.md at {paths.user_md_file}")
        return UserProfileResponse(content=request.content or None)
    except Exception as e:
        logger.error(f"Failed to update user profile: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Failed to update user profile: {str(e)}")


@router.delete(
    "/agents/{name}",
    status_code=204,
    summary="Delete Custom Agent",
    description="Delete a custom agent and all its files (config, SOUL.md, memory).",
)
async def delete_agent(name: str) -> None:
    """Delete a custom agent.

    Args:
        name: The agent name.

    Raises:
        HTTPException: 404 if agent not found.
    """
    _validate_agent_name(name)
    name = _normalize_agent_name(name)

    agent_dir = get_paths().agent_dir(name)

    if not agent_dir.exists():
        raise HTTPException(status_code=404, detail=f"Agent '{name}' not found")

    try:
        shutil.rmtree(agent_dir)
        logger.info(f"Deleted agent '{name}' from {agent_dir}")
    except Exception as e:
        logger.error(f"Failed to delete agent '{name}': {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Failed to delete agent: {str(e)}")
