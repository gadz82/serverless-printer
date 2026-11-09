# Placement (illustrative):
#   src/domain/order/order.py                  -> Order
#   src/domain/order/order_line.py             -> OrderLine
#   src/domain/order/order_placed.py           -> OrderPlaced
#   src/domain/order_repository.py             -> OrderRepository

from __future__ import annotations

from dataclasses import dataclass, field
from decimal import Decimal
from typing import Protocol


@dataclass(frozen=True)
class OrderLine:
    sku: str
    quantity: int
    unit_price: Decimal


@dataclass(frozen=True)
class OrderPlaced:
    order_id: str
    total: Decimal


@dataclass
class Order:
    id: str
    lines: tuple[OrderLine, ...]
    total: Decimal
    _events: list[OrderPlaced] = field(default_factory=list, repr=False)

    @classmethod
    def place(cls, order_id: str, lines: tuple[OrderLine, ...]) -> Order:
        if not lines:
            raise ValueError("order requires at least one line")
        if any(line.quantity <= 0 for line in lines):
            raise ValueError("quantity must be positive")
        total = sum((line.quantity * line.unit_price for line in lines), Decimal("0"))
        order = cls(order_id, lines, total)
        order._events.append(OrderPlaced(order_id, total))
        return order

    def pull_events(self) -> tuple[OrderPlaced, ...]:
        events = tuple(self._events)
        self._events.clear()
        return events


class OrderRepository(Protocol):
    async def save(self, order: Order) -> None: ...
