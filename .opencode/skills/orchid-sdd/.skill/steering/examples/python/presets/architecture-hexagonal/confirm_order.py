# Placement (illustrative):
#   src/domain/order.py                        -> Order
#   src/application/confirm_order.py           -> ConfirmOrder
#   src/ports/order_repository.py              -> OrderRepository
#   src/adapters/in_memory_order_repository.py -> InMemoryOrderRepository

from __future__ import annotations

from dataclasses import dataclass
from typing import Protocol


@dataclass(frozen=True)
class Order:
    id: str
    confirmed: bool


class OrderRepository(Protocol):
    async def find(self, order_id: str) -> Order | None: ...
    async def save(self, order: Order) -> None: ...


class ConfirmOrder:
    def __init__(self, orders: OrderRepository) -> None:
        self._orders = orders

    async def execute(self, order_id: str) -> Order:
        order = await self._orders.find(order_id)
        if order is None:
            raise LookupError("order not found")
        if order.confirmed:
            return order
        confirmed = Order(order.id, True)
        await self._orders.save(confirmed)
        return confirmed


class InMemoryOrderRepository:
    def __init__(self) -> None:
        self._orders: dict[str, Order] = {}

    async def find(self, order_id: str) -> Order | None:
        return self._orders.get(order_id)

    async def save(self, order: Order) -> None:
        self._orders[order.id] = order
