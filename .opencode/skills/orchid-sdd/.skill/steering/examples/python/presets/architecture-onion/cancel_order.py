# Placement (illustrative):
#   src/domain/order.py                        -> Order
#   src/domain/order_repository.py             -> OrderRepository
#   src/application/cancel_order.py            -> CancelOrder
#   src/infrastructure/in_memory_order_repository.py -> InMemoryOrderRepository

from __future__ import annotations

from dataclasses import dataclass, replace
from typing import Protocol


@dataclass(frozen=True)
class Order:
    id: str
    status: str = "placed"


class OrderRepository(Protocol):
    async def find(self, order_id: str) -> Order | None: ...
    async def save(self, order: Order) -> None: ...


class CancelOrder:
    def __init__(self, orders: OrderRepository) -> None:
        self._orders = orders

    async def execute(self, order_id: str) -> Order:
        order = await self._orders.find(order_id)
        if order is None:
            raise LookupError("order not found")
        if order.status == "cancelled":
            return order
        cancelled = replace(order, status="cancelled")
        await self._orders.save(cancelled)
        return cancelled


class InMemoryOrderRepository:
    def __init__(self) -> None:
        self._rows: dict[str, Order] = {}

    async def find(self, order_id: str) -> Order | None:
        return self._rows.get(order_id)

    async def save(self, order: Order) -> None:
        self._rows[order.id] = order
