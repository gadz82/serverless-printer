// Placement (illustrative):
//   src/domain/events/order-placed.ts          -> OrderPlaced
//   src/application/order-event-publisher.ts   -> OrderEventPublisher
//   src/application/order-projection-consumer.ts -> OrderProjectionConsumer
//   src/ports/event-publisher.ts               -> EventPublisher
//   src/ports/processed-event-store.ts         -> ProcessedEventStore

// Event-driven: a versioned fact, an explicit publisher, and an idempotent consumer.
export type OrderPlaced = {
  readonly type: "OrderPlaced";
  readonly version: 1;
  readonly eventId: string;
  readonly orderId: string;
  readonly total: number;
};

export interface EventPublisher {
  publish(event: OrderPlaced): Promise<void>;
}

export class OrderEventPublisher {
  constructor(private readonly publisher: EventPublisher) {}

  async publish(orderId: string, total: number, eventId: string): Promise<void> {
    if (total <= 0) throw new Error("total must be positive");
    await this.publisher.publish({
      type: "OrderPlaced",
      version: 1,
      eventId,
      orderId,
      total,
    });
  }
}

export interface ProcessedEventStore {
  has(eventId: string): Promise<boolean>;
  mark(eventId: string): Promise<void>;
}

export class OrderProjectionConsumer {
  constructor(
    private readonly processed: ProcessedEventStore,
    private readonly project: (event: OrderPlaced) => Promise<void>,
  ) {}

  async handle(event: OrderPlaced): Promise<"processed" | "duplicate"> {
    if (await this.processed.has(event.eventId)) return "duplicate";
    await this.project(event);
    await this.processed.mark(event.eventId);
    return "processed";
  }
}
