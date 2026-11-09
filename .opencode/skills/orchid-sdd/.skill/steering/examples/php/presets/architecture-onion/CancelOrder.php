<?php

// Placement (illustrative):
//   src/domain/Order.php                       -> Order
//   src/domain/OrderRepository.php             -> OrderRepository
//   src/application/CancelOrder.php            -> CancelOrder
//   src/infrastructure/InMemoryOrderRepository.php -> InMemoryOrderRepository

declare(strict_types=1);

final class Order
{
    public function __construct(
        public readonly string $id,
        public readonly string $status,
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

final class CancelOrder
{
    public function __construct(private readonly OrderRepository $orders)
    {
    }

    public function execute(string $id): Order
    {
        $order = $this->orders->find($id);
        if ($order === null) {
            throw new OrderNotFound('order not found');
        }
        if ($order->status === 'cancelled') {
            return $order;
        }

        $cancelled = new Order($order->id, 'cancelled');
        $this->orders->save($cancelled);
        return $cancelled;
    }
}

final class InMemoryOrderRepository implements OrderRepository
{
    /** @var array<string, Order> */
    private array $rows = [];

    public function find(string $id): ?Order
    {
        return $this->rows[$id] ?? null;
    }

    public function save(Order $order): void
    {
        $this->rows[$order->id] = $order;
    }
}
