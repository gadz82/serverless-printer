// Placement (illustrative):
//   src/domain/order-line.ts                   -> OrderLine
//   src/application/commands/place-order.ts    -> PlaceOrder, PlaceOrderHandler
//   src/application/queries/order-summary.ts   -> OrderSummary, OrderSummaryReader, GetOrderSummary

// CQRS: commands change state through a write boundary; queries read a projection.
export type OrderLine = {
  readonly sku: string;
  readonly quantity: number;
  readonly unitPrice: number;
};

export type PlaceOrderCommand = {
  readonly orderId: string;
  readonly lines: readonly OrderLine[];
};

export interface OrderWriter {
  save(command: PlaceOrderCommand): Promise<void>;
}

export class PlaceOrderHandler {
  constructor(private readonly writer: OrderWriter) {}

  async execute(command: PlaceOrderCommand): Promise<void> {
    if (command.lines.length === 0) throw new Error("order requires at least one line");
    await this.writer.save(command);
  }
}

export type OrderSummary = {
  readonly orderId: string;
  readonly lineCount: number;
  readonly total: number;
};

export interface OrderSummaryReader {
  byId(orderId: string): Promise<OrderSummary | null>;
}

export class GetOrderSummary {
  constructor(private readonly reader: OrderSummaryReader) {}

  async execute(orderId: string): Promise<OrderSummary> {
    const summary = await this.reader.byId(orderId);
    if (!summary) throw new Error("order summary not found");
    return summary;
  }
}
