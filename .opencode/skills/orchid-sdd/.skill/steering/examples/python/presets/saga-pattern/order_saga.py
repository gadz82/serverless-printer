# Placement (illustrative):
#   src/application/place_order_saga.py        -> PlaceOrderSaga
#   src/ports/stock_service.py                 -> StockService
#   src/ports/payment_service.py               -> PaymentService
#   src/ports/saga_store.py                    -> SagaStore

from __future__ import annotations

import asyncio
from dataclasses import dataclass
from decimal import Decimal
from typing import Protocol


class StockService(Protocol):
    async def reserve(self, order_id: str, idempotency_key: str) -> None: ...
    async def release(self, order_id: str, idempotency_key: str) -> None: ...


class PaymentService(Protocol):
    async def charge(self, order_id: str, amount: Decimal, idempotency_key: str) -> None: ...
    async def refund(self, order_id: str, amount: Decimal, idempotency_key: str) -> None: ...


class SagaStore(Protocol):
    async def save(self, order_id: str, state: str) -> None: ...


@dataclass(frozen=True)
class PlaceOrderSaga:
    stock: StockService
    payments: PaymentService
    store: SagaStore

    async def execute(self, order_id: str, amount: Decimal, idempotency_key: str) -> None:
        if amount <= 0:
            raise ValueError("amount must be positive")
        await self.store.save(order_id, "started")
        await self.stock.reserve(order_id, f"{idempotency_key}:stock")
        await self.store.save(order_id, "stock_reserved")
        try:
            await self.payments.charge(order_id, amount, f"{idempotency_key}:payment")
            await self.store.save(order_id, "completed")
        except Exception:
            compensation = await asyncio.gather(
                self.payments.refund(order_id, amount, f"{idempotency_key}:refund"),
                self.stock.release(order_id, f"{idempotency_key}:release"),
                return_exceptions=True,
            )
            await self.store.save(order_id, "compensated")
            failures = [result for result in compensation if isinstance(result, BaseException)]
            if failures:
                raise RuntimeError("saga compensation incomplete") from failures[0]
            raise
