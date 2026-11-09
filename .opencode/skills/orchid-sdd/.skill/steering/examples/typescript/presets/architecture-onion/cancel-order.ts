// Placement (illustrative):
//   src/domain/order.ts                        -> Order
//   src/domain/order-repository.ts             -> OrderRepository
//   src/application/cancel-order.ts            -> CancelOrder
//   src/infrastructure/in-memory-order-repository.ts -> InMemoryOrderRepository

// Onion: the application service depends on an inner contract; the adapter stays outside.
export type Order = {
  readonly id: string;
  readonly status: "placed" | "cancelled";
};

export interface OrderRepository {
  find(id: string): Promise<Order | null>;
  save(order: Order): Promise<void>;
}

export class CancelOrder {
  constructor(private readonly orders: OrderRepository) {}

  async execute(id: string): Promise<Order> {
    const order = await this.orders.find(id);
    if (!order) throw new Error("order not found");
    if (order.status === "cancelled") return order;
    const cancelled: Order = { ...order, status: "cancelled" };
    await this.orders.save(cancelled);
    return cancelled;
  }
}

export class InMemoryOrderRepository implements OrderRepository {
  private readonly rows = new Map<string, Order>();

  async find(id: string): Promise<Order | null> {
    return this.rows.get(id) ?? null;
  }

  async save(order: Order): Promise<void> {
    this.rows.set(order.id, order);
  }
}
