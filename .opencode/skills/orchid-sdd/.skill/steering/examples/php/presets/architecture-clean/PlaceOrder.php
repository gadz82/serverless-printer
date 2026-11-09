<?php

// Placement (illustrative):
//   src/domain/Order.php                       -> Order, OrderLine
//   src/application/PlaceOrder.php             -> PlaceOrder
//   src/ports/OrderRepository.php              -> OrderRepository
//   src/ports/PaymentGateway.php               -> PaymentGateway

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

final class Order
{
    public function __construct(
        public readonly string $id,
        public readonly array $lines,
        public readonly int $total,
    ) {
    }
}

interface OrderRepository
{
    public function save(Order $order): void;
}

interface PaymentGateway
{
    public function charge(string $orderId, int $amount): void;
}

final class PlaceOrder
{
    public function __construct(
        private readonly OrderRepository $orders,
        private readonly PaymentGateway $payments,
    ) {
    }

    public function execute(string $id, array $lines): Order
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
        if ($total <= 0) {
            throw new InvalidArgumentException('order total must be positive');
        }

        $order = new Order($id, $lines, $total);
        $this->payments->charge($order->id, $order->total);
        $this->orders->save($order);
        return $order;
    }
}
