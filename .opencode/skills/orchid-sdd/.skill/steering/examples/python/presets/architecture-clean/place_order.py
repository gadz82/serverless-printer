# Placement (illustrative):
#   src/domain/order.py                        -> Order, OrderLine
#   src/application/place_order.py             -> PlaceOrder
#   src/ports/order_repository.py              -> OrderRepository
#   src/ports/payment_gateway.py               -> PaymentGateway

from __future__ import annotations

from dataclasses import dataclass
from decimal import Decimal
from typing import Protocol


@dataclass(frozen=True)
class OrderLine:
    sku: str
    quantity: int
    unit_price: Decimal


@dataclass(frozen=True)
class Order:
    id: str
    lines: tuple[OrderLine, ...]
    total: Decimal

    @classmethod
    def place(cls, order_id: str, lines: tuple[OrderLine, ...]) -> Order:
        if not lines:
            raise ValueError("order requires at least one line")
        total = sum((line.quantity * line.unit_price for line in lines), Decimal("0"))
        if total <= 0:
            raise ValueError("order total must be positive")
        return cls(order_id, lines, total)


class OrderRepository(Protocol):
    async def save(self, order: Order) -> None: ...


class PaymentGateway(Protocol):
    async def charge(self, order_id: str, amount: Decimal) -> None: ...


class PlaceOrder:
    def __init__(self, orders: OrderRepository, payments: PaymentGateway) -> None:
        self._orders = orders
        self._payments = payments

    async def execute(self, order_id: str, lines: tuple[OrderLine, ...]) -> Order:
        order = Order.place(order_id, lines)
        await self._payments.charge(order.id, order.total)
        await self._orders.save(order)
        return order
