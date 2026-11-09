# Placement (illustrative):
#   src/payments/payment_request.py            -> PaymentRequest
#   src/payments/payment_gateway.py            -> PaymentGateway
#   src/payments/payment_service.py            -> PaymentService

from __future__ import annotations

from dataclasses import dataclass
from decimal import Decimal
from typing import Protocol


@dataclass(frozen=True)
class PaymentRequest:
    order_id: str
    amount: Decimal


class PaymentGateway(Protocol):
    async def charge(self, request: PaymentRequest) -> None: ...


class PaymentService:
    def __init__(self, gateway: PaymentGateway) -> None:
        self._gateway = gateway

    async def charge(self, order_id: str, amount: Decimal) -> None:
        if not order_id:
            raise ValueError("order_id is required")
        if amount <= 0:
            raise ValueError("amount must be positive")
        # The provider timeout is intentional: a retry must use the same idempotency key.
        await self._gateway.charge(PaymentRequest(order_id, amount))
