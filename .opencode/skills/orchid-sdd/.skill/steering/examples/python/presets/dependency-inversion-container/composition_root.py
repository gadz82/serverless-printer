# Placement (illustrative):
#   src/application/place_order.py             -> PlaceOrder
#   src/ports/clock.py                         -> Clock
#   src/ports/order_repository.py              -> OrderRepository
#   src/ports/payment_gateway.py               -> PaymentGateway
#   src/infrastructure/system_clock.py         -> SystemClock
#   src/infrastructure/in_memory_order_repository.py -> InMemoryOrderRepository
#   src/infrastructure/http_payment_gateway.py -> HttpPaymentGateway
#   src/composition_root.py                    -> composition root

from __future__ import annotations

from datetime import datetime, timezone
from typing import Protocol


class Clock(Protocol):
    def now(self) -> datetime: ...


class OrderRepository(Protocol):
    async def save(self, order_id: str, total: float, placed_at: datetime) -> None: ...


class PaymentGateway(Protocol):
    async def charge(self, order_id: str, amount: float) -> None: ...


class SystemClock:
    def now(self) -> datetime:
        return datetime.now(timezone.utc)


class InMemoryOrderRepository:
    def __init__(self) -> None:
        self._rows: dict[str, tuple[float, datetime]] = {}

    async def save(self, order_id: str, total: float, placed_at: datetime) -> None:
        self._rows[order_id] = (total, placed_at)


class HttpPaymentGateway:
    def __init__(self, base_url: str) -> None:
        self._base_url = base_url

    async def charge(self, order_id: str, amount: float) -> None:
        if not self._base_url:
            raise ValueError("payment base URL is required")
        if amount <= 0:
            raise ValueError("amount must be positive")
        # Call the provider here; the domain never sees its SDK.


class PlaceOrder:
    def __init__(self, clock: Clock, orders: OrderRepository, payments: PaymentGateway) -> None:
        self._clock = clock
        self._orders = orders
        self._payments = payments

    async def execute(self, order_id: str, total: float) -> None:
        if total <= 0:
            raise ValueError("total must be positive")
        await self._payments.charge(order_id, total)
        await self._orders.save(order_id, total, self._clock.now())


def composition_root(base_url: str) -> PlaceOrder:
    return PlaceOrder(SystemClock(), InMemoryOrderRepository(), HttpPaymentGateway(base_url))
