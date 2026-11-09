<?php

// Placement (illustrative):
//   src/domain/order/Order.php                 -> Order
//   src/domain/order/OrderLine.php             -> OrderLine
//   src/domain/order/OrderPlaced.php           -> OrderPlaced
//   src/domain/OrderRepository.php             -> OrderRepository

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

final class OrderPlaced
{
    public function __construct(
        public readonly string $orderId,
        public readonly int $total,
    ) {
    }
}

final class Order
{
    /** @var list<OrderPlaced> */
    private array $events = [];

    private function __construct(
        public readonly string $id,
        public readonly array $lines,
        public readonly int $total,
    ) {
    }

    public static function place(string $id, array $lines): self
    {
        if ($lines === []) {
            throw new InvalidArgumentException('order requires at least one line');
        }

        $total = 0;
        foreach ($lines as $line) {
            if (!$line instanceof OrderLine || $line->quantity <= 0) {
                throw new InvalidArgumentException('quantity must be positive');
            }
            $total += $line->quantity * $line->unitPrice;
        }

        $order = new self($id, $lines, $total);
        $order->events[] = new OrderPlaced($id, $total);
        return $order;
    }

    /** @return list<OrderPlaced> */
    public function pullEvents(): array
    {
        $events = $this->events;
        $this->events = [];
        return $events;
    }
}

interface OrderRepository
{
    public function save(Order $order): void;
}
