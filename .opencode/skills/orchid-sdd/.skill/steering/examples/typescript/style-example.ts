// Placement (illustrative):
//   src/payments/payment-request.ts            -> PaymentRequest
//   src/payments/payment-gateway.ts            -> PaymentGateway
//   src/payments/payment-service.ts            -> PaymentService
//   src/payments/payment-declined.ts           -> PaymentDeclined

// Style exemplar: explicit types, no implicit any, named errors, and a why-only comment.
export class PaymentDeclined extends Error {
  constructor(readonly code: string) {
    super(`payment declined: ${code}`);
    this.name = "PaymentDeclined";
  }
}

export type PaymentRequest = {
  readonly orderId: string;
  readonly amount: number;
};

export interface PaymentGateway {
  charge(request: PaymentRequest): Promise<void>;
}

export class PaymentService {
  constructor(private readonly gateway: PaymentGateway) {}

  async charge(orderId: string, amount: number): Promise<void> {
    if (!orderId) throw new Error("orderId is required");
    if (!Number.isFinite(amount) || amount <= 0) {
      throw new Error("amount must be positive");
    }
    // The provider timeout is intentional: a retry must use the same idempotency key.
    await this.gateway.charge({ orderId, amount });
  }
}
