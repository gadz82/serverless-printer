<?php

// Placement (illustrative):
//   src/domain/Order.php                       -> Order
//   src/application/ConfirmOrder.php           -> ConfirmOrder
//   src/ports/OrderRepository.php              -> OrderRepository
//   src/adapters/InMemoryOrderRepository.php   -> InMemoryOrderRepository

declare(strict_types=1);

final class Order
{
    public function __construct(
        public readonly string $id,
        public readonly bool $confirmed,
    ) {
    }
}

final class OrderNotFound extends RuntimeException
{
}

interface OrderRepository
{
    public function find(string $id): ?Order;
    public function save(Order $order): void;
}

final class ConfirmOrder
{
    public function __construct(private readonly OrderRepository $orders)
    {
    }

    public function execute(string $orderId): Order
    {
        $order = $this->orders->find($orderId);
        if ($order === null) {
            throw new OrderNotFound('order not found');
        }
        if ($order->confirmed) {
            return $order;
        }

        $confirmed = new Order($order->id, true);
        $this->orders->save($confirmed);
        return $confirmed;
    }
}

final class InMemoryOrderRepository implements OrderRepository
{
    /** @var array<string, Order> */
    private array $orders = [];

    public function find(string $id): ?Order
    {
        return $this->orders[$id] ?? null;
    }

    public function save(Order $order): void
    {
        $this->orders[$order->id] = $order;
    }
}
