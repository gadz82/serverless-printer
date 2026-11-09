# Placement (illustrative):
#   src/domain/order_line.py                   -> OrderLine
#   src/application/commands/place_order.py    -> PlaceOrder, PlaceOrderHandler
#   src/application/queries/order_summary.py   -> OrderSummary, OrderSummaryReader, GetOrderSummary

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
class PlaceOrder:
    order_id: str
    lines: tuple[OrderLine, ...]


class OrderWriter(Protocol):
    async def save(self, command: PlaceOrder) -> None: ...


class PlaceOrderHandler:
    def __init__(self, writer: OrderWriter) -> None:
        self._writer = writer

    async def execute(self, command: PlaceOrder) -> None:
        if not command.lines:
            raise ValueError("order requires at least one line")
        await self._writer.save(command)


@dataclass(frozen=True)
class OrderSummary:
    order_id: str
    line_count: int
    total: Decimal


class OrderSummaryReader(Protocol):
    async def by_id(self, order_id: str) -> OrderSummary | None: ...


class GetOrderSummary:
    def __init__(self, reader: OrderSummaryReader) -> None:
        self._reader = reader

    async def execute(self, order_id: str) -> OrderSummary:
        summary = await self._reader.by_id(order_id)
        if summary is None:
            raise LookupError("order summary not found")
        return summary
