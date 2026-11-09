<?php

// Placement (illustrative):
//   src/application/PlaceOrder.php             -> PlaceOrder
//   src/ports/Clock.php                        -> Clock
//   src/ports/OrderRepository.php              -> OrderRepository
//   src/ports/PaymentGateway.php               -> PaymentGateway
//   src/infrastructure/SystemClock.php         -> SystemClock
//   src/infrastructure/InMemoryOrderRepository.php -> InMemoryOrderRepository
//   src/infrastructure/HttpPaymentGateway.php  -> HttpPaymentGateway
//   src/CompositionRoot.php                    -> composition root

declare(strict_types=1);

interface Clock
{
    public function now(): DateTimeImmutable;
}

interface OrderRepository
{
    public function save(string $orderId, int $total, DateTimeImmutable $placedAt): void;
}

interface PaymentGateway
{
    public function charge(string $orderId, int $amount): void;
}

final class SystemClock implements Clock
{
    public function now(): DateTimeImmutable
    {
        return new DateTimeImmutable('now', new DateTimeZone('UTC'));
    }
}

final class InMemoryOrderRepository implements OrderRepository
{
    /** @var array<string, array{total: int, placedAt: DateTimeImmutable}> */
    private array $rows = [];

    public function save(string $orderId, int $total, DateTimeImmutable $placedAt): void
    {
        $this->rows[$orderId] = ['total' => $total, 'placedAt' => $placedAt];
    }
}

final class HttpPaymentGateway implements PaymentGateway
{
    public function __construct(private readonly string $baseUrl)
    {
    }

    public function charge(string $orderId, int $amount): void
    {
        if ($this->baseUrl === '') {
            throw new InvalidArgumentException('payment base URL is required');
        }
        if ($amount <= 0) {
            throw new InvalidArgumentException('amount must be positive');
        }
        // Call the provider here; the domain never sees its SDK.
    }
}

final class PlaceOrder
{
    public function __construct(
        private readonly Clock $clock,
        private readonly OrderRepository $orders,
        private readonly PaymentGateway $payments,
    ) {
    }

    public function execute(string $orderId, int $total): void
    {
        if ($total <= 0) {
            throw new InvalidArgumentException('total must be positive');
        }
        $this->payments->charge($orderId, $total);
        $this->orders->save($orderId, $total, $this->clock->now());
    }
}

function compositionRoot(string $baseUrl): PlaceOrder
{
    return new PlaceOrder(new SystemClock(), new InMemoryOrderRepository(), new HttpPaymentGateway($baseUrl));
}
