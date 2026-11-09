// Placement (illustrative):
//   src/application/place-order-saga.ts        -> PlaceOrderSaga
//   src/ports/stock-service.ts                 -> StockService
//   src/ports/payment-service.ts               -> PaymentService
//   src/ports/saga-store.ts                    -> SagaStore

// Orchestrated SAGA: persistent state, idempotency keys, and explicit compensation.
export type SagaState =
  | "started"
  | "stock_reserved"
  | "payment_charged"
  | "completed"
  | "compensated";

export interface StockService {
  reserve(orderId: string, idempotencyKey: string): Promise<void>;
  release(orderId: string, idempotencyKey: string): Promise<void>;
}

export interface PaymentService {
  charge(orderId: string, amount: number, idempotencyKey: string): Promise<void>;
  refund(orderId: string, amount: number, idempotencyKey: string): Promise<void>;
}

export interface SagaStore {
  save(orderId: string, state: SagaState): Promise<void>;
}

export class PlaceOrderSaga {
  constructor(
    private readonly stock: StockService,
    private readonly payments: PaymentService,
    private readonly store: SagaStore,
  ) {}

  async execute(orderId: string, amount: number, idempotencyKey: string): Promise<void> {
    if (amount <= 0) throw new Error("amount must be positive");
    await this.store.save(orderId, "started");
    await this.stock.reserve(orderId, `${idempotencyKey}:stock`);
    await this.store.save(orderId, "stock_reserved");
    try {
      await this.payments.charge(orderId, amount, `${idempotencyKey}:payment`);
      await this.store.save(orderId, "completed");
    } catch (error) {
      const compensation = await Promise.allSettled([
        this.payments.refund(orderId, amount, `${idempotencyKey}:refund`),
        this.stock.release(orderId, `${idempotencyKey}:release`),
      ]);
      await this.store.save(orderId, "compensated");
      const failures = compensation
        .filter((result): result is PromiseRejectedResult => result.status === "rejected")
        .map((result) => result.reason);
      if (failures.length > 0) {
        throw new AggregateError([error, ...failures], "saga compensation incomplete");
      }
      throw error;
    }
  }
}
