# Placement (illustrative):
#   src/domain/events/order_placed.py          -> OrderPlaced
#   src/application/order_event_publisher.py   -> OrderEventPublisher
#   src/application/order_projection_consumer.py -> OrderProjectionConsumer
#   src/ports/event_publisher.py               -> EventPublisher
#   src/ports/processed_event_store.py         -> ProcessedEventStore

from __future__ import annotations

from dataclasses import dataclass
from decimal import Decimal
from typing import Awaitable, Callable, Protocol


@dataclass(frozen=True)
class OrderPlaced:
    event_id: str
    order_id: str
    total: Decimal
    version: int = 1


class EventPublisher(Protocol):
    async def publish(self, event: OrderPlaced) -> None: ...


class ProcessedEventStore(Protocol):
    async def has(self, event_id: str) -> bool: ...
    async def mark(self, event_id: str) -> None: ...


class OrderEventPublisher:
    def __init__(self, publisher: EventPublisher) -> None:
        self._publisher = publisher

    async def publish(self, order_id: str, total: Decimal, event_id: str) -> None:
        if total <= 0:
            raise ValueError("total must be positive")
        await self._publisher.publish(OrderPlaced(event_id, order_id, total))


class OrderProjectionConsumer:
    def __init__(
        self,
        processed: ProcessedEventStore,
        project: Callable[[OrderPlaced], Awaitable[None]],
    ) -> None:
        self._processed = processed
        self._project = project

    async def handle(self, event: OrderPlaced) -> str:
        if await self._processed.has(event.event_id):
            return "duplicate"
        await self._project(event)
        await self._processed.mark(event.event_id)
        return "processed"
