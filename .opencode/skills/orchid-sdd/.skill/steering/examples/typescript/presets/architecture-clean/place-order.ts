// Placement (illustrative):
//   src/domain/order.ts                        -> Order, OrderLine
//   src/application/place-order.ts             -> PlaceOrder
//   src/ports/order-repository.ts              -> OrderRepository
//   src/ports/payment-gateway.ts               -> PaymentGateway

// Clean architecture: the use case depends on ports, never on transport or persistence.
export type OrderLine = {
  readonly sku: string;
  readonly quantity: number;
  readonly unitPrice: number;
};

export class Order {
  private constructor(
    readonly id: string,
    readonly lines: readonly OrderLine[],
    readonly total: number,
  ) {}

  static place(id: string, lines: readonly OrderLine[]): Order {
    if (lines.length === 0) throw new Error("order requires at least one line");
    const total = lines.reduce((sum, line) => sum + line.quantity * line.unitPrice, 0);
    if (total <= 0) throw new Error("order total must be positive");
    return new Order(id, lines, total);
  }
}

export interface OrderRepository {
  save(order: Order): Promise<void>;
}

export interface PaymentGateway {
  charge(orderId: string, amount: number): Promise<void>;
}

export class PlaceOrder {
  constructor(
    private readonly orders: OrderRepository,
    private readonly payments: PaymentGateway,
  ) {}

  async execute(id: string, lines: readonly OrderLine[]): Promise<Order> {
    const order = Order.place(id, lines);
    await this.payments.charge(order.id, order.total);
    await this.orders.save(order);
    return order;
  }
}
