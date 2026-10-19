from __future__ import annotations

from dataclasses import dataclass
from typing import Literal, TypeAlias

from pydantic import BaseModel

JsonScalar: TypeAlias = str | int | float | bool | None
JsonValue: TypeAlias = JsonScalar | dict[str, "JsonValue"] | list["JsonValue"]
JsonObject: TypeAlias = dict[str, JsonValue]


@dataclass(slots=True)
class Notification:
    method: str
    payload: JsonObject


@dataclass(slots=True)
class IncomingRequest:
    id: str | int
    method: str
    payload: JsonObject


class ServerInfo(BaseModel):
    name: str | None = None
    version: str | None = None


class InitializeResponse(BaseModel):
    serverInfo: ServerInfo | None = None


class ApprovalRequestParams(BaseModel):
    """Server-to-client approval/request payload after explicit handshake opt-in."""

    sessionId: str
    toolName: str
    callId: str | None = None
    reason: str | None = None


class ApprovalRequestResult(BaseModel):
    """One-operation decision; allowed-once is the only grant."""

    outcome: Literal["allowed-once", "rejected", "cancelled"]
