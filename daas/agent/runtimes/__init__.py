"""Runtime adapter registry.

Import any adapter module to have it self-register via
``register_runtime(name, factory)``. The registry lives in
``daas.agent.base.RUNTIMES``.

  Name                  Module                         Driver model class
  --------------------  -----------------------------  --------------------------------
  gemini_agent          daas.agent.runtimes.gemini     Gemini 3 Pro / Flash Lite (REST)
  openai_agents_sdk     daas.agent.runtimes.openai     openai-agents package
  claude_agent_sdk      daas.agent.runtimes.claude     claude-agent-sdk package
  langgraph             daas.agent.runtimes.langgraph  langgraph v1 + create_react_agent
  openrouter            daas.agent.runtimes.openrouter OpenAI-compatible gateway
"""

# Self-register all adapters when daas.agent.runtimes is imported.
from daas.agent.runtimes import (  # noqa: F401
    gemini,
    openai,
    openrouter,
    claude,
    langgraph,
)

__all__: list[str] = []
