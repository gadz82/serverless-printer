<?php

// Placement (illustrative):
//   src/application/PlaceOrderSaga.php         -> PlaceOrderSaga
//   src/ports/StockService.php                 -> StockService
//   src/ports/PaymentService.php               -> PaymentService
//   src/ports/SagaStore.php                    -> SagaStore

declare(strict_types=1);

interface StockService
{
    public function reserve(string $orderId, string $idempotencyKey): void;
    public function release(string $orderId, string $idempotencyKey): void;
}

interface PaymentService
{
    public function charge(string $orderId, int $amount, string $idempotencyKey): void;
    public function refund(string $orderId, int $amount, string $idempotencyKey): void;
}

interface SagaStore
{
    public function save(string $orderId, string $state): void;
}

final class PlaceOrderSaga
{
    public function __construct(
        private readonly StockService $stock,
        private readonly PaymentService $payments,
        private readonly SagaStore $store,
    ) {
    }

    public function execute(string $orderId, int $amount, string $idempotencyKey): void
    {
        if ($amount <= 0) {
            throw new InvalidArgumentException('amount must be positive');
        }

        $this->store->save($orderId, 'started');
        $this->stock->reserve($orderId, $idempotencyKey . ':stock');
        $this->store->save($orderId, 'stock_reserved');

        try {
            $this->payments->charge($orderId, $amount, $idempotencyKey . ':payment');
            $this->store->save($orderId, 'completed');
        } catch (Throwable $error) {
            $failures = [];
            try {
                $this->payments->refund($orderId, $amount, $idempotencyKey . ':refund');
            } catch (Throwable $compensation) {
                $failures[] = $compensation;
            }
            try {
                $this->stock->release($orderId, $idempotencyKey . ':release');
            } catch (Throwable $compensation) {
                $failures[] = $compensation;
            }
            $this->store->save($orderId, 'compensated');

            if ($failures !== []) {
                throw new RuntimeException('saga compensation incomplete', 0, $error);
            }
            throw $error;
        }
    }
}
