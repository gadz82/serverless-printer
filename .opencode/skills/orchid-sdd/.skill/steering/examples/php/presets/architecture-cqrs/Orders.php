<?php

// Placement (illustrative):
//   src/domain/OrderLine.php                   -> OrderLine
//   src/application/commands/PlaceOrder.php    -> PlaceOrder, PlaceOrderHandler
//   src/application/queries/OrderSummary.php   -> OrderSummary, OrderSummaryReader, GetOrderSummary

declare(strict_types=1);

final class OrderLine
{
    public function __construct(
        public readonly string $sku,
        public readonly int $quantity,
        public readonly int $unitPrice,
    ) {
    }
}

final class PlaceOrder
{
    public function __construct(
        public readonly string $orderId,
        public readonly array $lines,
    ) {
    }
}

final class OrderSummary
{
    public function __construct(
        public readonly string $orderId,
        public readonly int $lineCount,
        public readonly int $total,
    ) {
    }
}

interface OrderWriter
{
    public function save(PlaceOrder $command): void;
}

interface OrderSummaryReader
{
    public function byId(string $orderId): ?OrderSummary;
}

final class PlaceOrderHandler
{
    public function __construct(private readonly OrderWriter $writer)
    {
    }

    public function execute(PlaceOrder $command): void
    {
        if ($command->lines === []) {
            throw new InvalidArgumentException('order requires at least one line');
        }
        $this->writer->save($command);
    }
}

final class GetOrderSummary
{
    public function __construct(private readonly OrderSummaryReader $reader)
    {
    }

    public function execute(string $orderId): OrderSummary
    {
        $summary = $this->reader->byId($orderId);
        if ($summary === null) {
            throw new RuntimeException('order summary not found');
        }
        return $summary;
    }
}
