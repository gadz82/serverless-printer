// Placement (illustrative):
//   src/domain/events/OrderPlaced.java         -> OrderPlaced
//   src/application/OrderEventPublisher.java   -> OrderEventPublisher
//   src/application/OrderProjectionConsumer.java -> OrderProjectionConsumer
//   src/ports/EventPublisher.java              -> EventPublisher
//   src/ports/ProcessedEventStore.java         -> ProcessedEventStore

import java.math.BigDecimal;

public final class OrderEvents {
    public record OrderPlaced(String eventId, String orderId, BigDecimal total, int version) {}

    public interface EventPublisher {
        void publish(OrderPlaced event);
    }

    public interface ProcessedEventStore {
        boolean has(String eventId);
        void mark(String eventId);
    }

    public static final class OrderEventPublisher {
        private final EventPublisher publisher;

        public OrderEventPublisher(EventPublisher publisher) {
            this.publisher = publisher;
        }

        public void publish(String eventId, String orderId, BigDecimal total) {
            if (total.signum() <= 0) {
                throw new IllegalArgumentException("total must be positive");
            }
            publisher.publish(new OrderPlaced(eventId, orderId, total, 1));
        }
    }

    public static final class OrderProjectionConsumer {
        private final ProcessedEventStore processed;

        public OrderProjectionConsumer(ProcessedEventStore processed) {
            this.processed = processed;
        }

        public String handle(OrderPlaced event) {
            if (processed.has(event.eventId())) {
                return "duplicate";
            }
            processed.mark(event.eventId());
            return "processed";
        }
    }
}
