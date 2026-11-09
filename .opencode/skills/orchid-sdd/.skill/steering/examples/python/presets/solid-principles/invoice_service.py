# Placement (illustrative):
#   src/domain/invoice_line.py                 -> InvoiceLine
#   src/application/invoice_service.py         -> InvoiceService
#   src/ports/invoice_repository.py            -> InvoiceRepository
#   src/ports/tax_calculator.py                -> TaxCalculator
#   src/infrastructure/flat_tax_calculator.py  -> FlatTaxCalculator

from __future__ import annotations

from dataclasses import dataclass
from decimal import Decimal
from typing import Protocol


@dataclass(frozen=True)
class InvoiceLine:
    description: str
    amount: Decimal


class InvoiceRepository(Protocol):
    async def save(self, invoice_id: str, total: Decimal) -> None: ...


class TaxCalculator(Protocol):
    def tax_for(self, amount: Decimal) -> Decimal: ...


class InvoiceService:
    def __init__(self, invoices: InvoiceRepository, tax: TaxCalculator) -> None:
        self._invoices = invoices
        self._tax = tax

    async def issue(self, invoice_id: str, lines: tuple[InvoiceLine, ...]) -> Decimal:
        if not lines:
            raise ValueError("invoice requires at least one line")
        subtotal = sum((line.amount for line in lines), Decimal("0"))
        if subtotal <= 0:
            raise ValueError("invoice total must be positive")
        total = subtotal + self._tax.tax_for(subtotal)
        await self._invoices.save(invoice_id, total)
        return total


class FlatTaxCalculator:
    def __init__(self, rate: Decimal) -> None:
        self._rate = rate

    def tax_for(self, amount: Decimal) -> Decimal:
        return amount * self._rate
