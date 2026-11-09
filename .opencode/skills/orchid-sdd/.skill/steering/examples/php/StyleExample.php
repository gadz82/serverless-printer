<?php

// Placement (illustrative):
//   src/payments/PaymentRequest.php            -> PaymentRequest
//   src/payments/PaymentGateway.php            -> PaymentGateway
//   src/payments/PaymentService.php            -> PaymentService

declare(strict_types=1);

final class PaymentRequest
{
    public function __construct(
        public readonly string $orderId,
        public readonly int $amount,
    ) {
    }
}

interface PaymentGateway
{
    public function charge(PaymentRequest $request): void;
}

final class PaymentService
{
    public function __construct(private readonly PaymentGateway $gateway)
    {
    }

    public function charge(string $orderId, int $amount): void
    {
        if ($orderId === '') {
            throw new InvalidArgumentException('orderId is required');
        }
        if ($amount <= 0) {
            throw new InvalidArgumentException('amount must be positive');
        }
        // The provider timeout is intentional: a retry must use the same idempotency key.
        $this->gateway->charge(new PaymentRequest($orderId, $amount));
    }
}
