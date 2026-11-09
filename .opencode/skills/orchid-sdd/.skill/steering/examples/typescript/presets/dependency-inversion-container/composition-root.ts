// Placement (illustrative):
//   src/application/place-order.ts             -> PlaceOrder
//   src/ports/clock.ts                         -> Clock
//   src/ports/order-repository.ts              -> OrderRepository
//   src/ports/payment-gateway.ts               -> PaymentGateway
//   src/infrastructure/system-clock.ts         -> SystemClock
//   src/infrastructure/in-memory-order-repository.ts -> InMemoryOrderRepository
//   src/infrastructure/http-payment-gateway.ts -> HttpPaymentGateway
//   src/composition-root.ts                    -> composition root

// Dependency inversion: concrete choices are wired once, at the composition root.
export interface Clock {
  now(): Date;
}

export interface OrderRepository {
  save(id: string, total: number, placedAt: Date): Promise<void>;
}

export interface PaymentGateway {
  charge(id: string, amount: number): Promise<void>;
}

export class SystemClock implements Clock {
  now(): Date {
    return new Date();
  }
}

export class InMemoryOrderRepository implements OrderRepository {
  private readonly rows = new Map<string, { total: number; placedAt: Date }>();

  async save(id: string, total: number, placedAt: Date): Promise<void> {
    this.rows.set(id, { total, placedAt });
  }
}

export class HttpPaymentGateway implements PaymentGateway {
  constructor(private readonly baseUrl: string) {}

  async charge(id: string, amount: number): Promise<void> {
    if (!this.baseUrl) throw new Error("payment base URL is required");
    if (amount <= 0) throw new Error("amount must be positive");
    // Call the provider here; the domain never sees its SDK.
  }
}

export class PlaceOrder {
  constructor(
    private readonly clock: Clock,
    private readonly orders: OrderRepository,
    private readonly payments: PaymentGateway,
  ) {}

  async execute(id: string, total: number): Promise<void> {
    if (total <= 0) throw new Error("total must be positive");
    await this.payments.charge(id, total);
    await this.orders.save(id, total, this.clock.now());
  }
}

export function compositionRoot(baseUrl: string): PlaceOrder {
  return new PlaceOrder(
    new SystemClock(),
    new InMemoryOrderRepository(),
    new HttpPaymentGateway(baseUrl),
  );
}
