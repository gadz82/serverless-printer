<?php

// Placement (illustrative):
//   src/domain/InvoiceLine.php                 -> InvoiceLine
//   src/application/InvoiceService.php         -> InvoiceService
//   src/ports/InvoiceRepository.php            -> InvoiceRepository
//   src/ports/TaxCalculator.php                -> TaxCalculator
//   src/infrastructure/FlatTaxCalculator.php   -> FlatTaxCalculator

declare(strict_types=1);

final class InvoiceLine
{
    public function __construct(
        public readonly string $description,
        public readonly int $amount,
    ) {
    }
}

interface InvoiceRepository
{
    public function save(string $invoiceId, int $total): void;
}

interface TaxCalculator
{
    public function taxFor(int $amount): int;
}

final class InvoiceService
{
    public function __construct(
        private readonly InvoiceRepository $invoices,
        private readonly TaxCalculator $tax,
    ) {
    }

    public function issue(string $invoiceId, array $lines): int
    {
        if ($lines === []) {
            throw new InvalidArgumentException('invoice requires at least one line');
        }

        $subtotal = 0;
        foreach ($lines as $line) {
            if (!$line instanceof InvoiceLine) {
                throw new InvalidArgumentException('invalid invoice line');
            }
            $subtotal += $line->amount;
        }
        if ($subtotal <= 0) {
            throw new InvalidArgumentException('invoice total must be positive');
        }

        $total = $subtotal + $this->tax->taxFor($subtotal);
        $this->invoices->save($invoiceId, $total);
        return $total;
    }
}

final class FlatTaxCalculator implements TaxCalculator
{
    public function __construct(private readonly int $ratePercent)
    {
    }

    public function taxFor(int $amount): int
    {
        return intdiv($amount * $this->ratePercent, 100);
    }
}
