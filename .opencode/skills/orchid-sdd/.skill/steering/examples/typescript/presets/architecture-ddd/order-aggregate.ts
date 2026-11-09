// Placement (illustrative):
//   src/domain/order/order.ts                  -> Order
//   src/domain/order/order-line.ts             -> OrderLine
//   src/domain/order/order-placed.ts           -> OrderPlaced
//   src/domain/order-repository.ts             -> OrderRepository

// DDD: the aggregate protects its invariants and records a domain event.
export type OrderLine = {
  readonly sku: string;
  readonly quantity: number;
  readonly unitPrice: number;
};

export type OrderPlaced = {
  readonly type: "OrderPlaced";
  readonly orderId: string;
  readonly total: number;
};

export class Order {
  private readonly events: OrderPlaced[] = [];

  private constructor(
    readonly id: string,
    readonly lines: readonly OrderLine[],
    readonly total: number,
  ) {}

  static place(id: string, lines: readonly OrderLine[]): Order {
    if (lines.length === 0) throw new Error("order requires at least one line");
    if (lines.some((line) => line.quantity <= 0)) {
      throw new Error("quantity must be positive");
    }
    const total = lines.reduce((sum, line) => sum + line.quantity * line.unitPrice, 0);
    const order = new Order(id, lines, total);
    order.events.push({ type: "OrderPlaced", orderId: id, total });
    return order;
  }

  pullEvents(): readonly OrderPlaced[] {
    const pending = [...this.events];
    this.events.length = 0;
    return pending;
  }
}

export interface OrderRepository {
  save(order: Order): Promise<void>;
}
