<?php

// Placement (illustrative):
//   src/domain/events/OrderPlaced.php          -> OrderPlaced
//   src/application/OrderEventPublisher.php    -> OrderEventPublisher
//   src/application/OrderProjectionConsumer.php -> OrderProjectionConsumer
//   src/ports/EventPublisher.php               -> EventPublisher
//   src/ports/ProcessedEventStore.php          -> ProcessedEventStore

declare(strict_types=1);

final class OrderPlaced
{
    public function __construct(
        public readonly string $eventId,
        public readonly string $orderId,
        public readonly int $total,
        public readonly int $version = 1,
    ) {
    }
}

interface EventPublisher
{
    public function publish(OrderPlaced $event): void;
}

interface ProcessedEventStore
{
    public function has(string $eventId): bool;
    public function mark(string $eventId): void;
}

final class OrderEventPublisher
{
    public function __construct(private readonly EventPublisher $publisher)
    {
    }

    public function publish(string $eventId, string $orderId, int $total): void
    {
        if ($total <= 0) {
            throw new InvalidArgumentException('total must be positive');
        }
        $this->publisher->publish(new OrderPlaced($eventId, $orderId, $total));
    }
}

final class OrderProjectionConsumer
{
    /** @param callable(OrderPlaced): void $project */
    public function __construct(
        private readonly ProcessedEventStore $processed,
        private readonly mixed $project,
    ) {
    }

    public function handle(OrderPlaced $event): string
    {
        if ($this->processed->has($event->eventId)) {
            return 'duplicate';
        }
        ($this->project)($event);
        $this->processed->mark($event->eventId);
        return 'processed';
    }
}
