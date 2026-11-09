// Placement (illustrative):
//   src/application/PlaceOrder.java            -> PlaceOrder
//   src/ports/Clock.java                       -> Clock
//   src/ports/OrderRepository.java             -> OrderRepository
//   src/ports/PaymentGateway.java              -> PaymentGateway
//   src/infrastructure/SystemClock.java        -> SystemClock
//   src/infrastructure/InMemoryOrderRepository.java -> InMemoryOrderRepository
//   src/infrastructure/HttpPaymentGateway.java -> HttpPaymentGateway
//   src/CompositionRoot.java                   -> composition root

import java.math.BigDecimal;
import java.time.Instant;
import java.util.HashMap;
import java.util.Map;

public final class CompositionRoot {
    public interface Clock {
        Instant now();
    }

    public interface OrderRepository {
        void save(String id, BigDecimal total, Instant placedAt);
    }

    public interface PaymentGateway {
        void charge(String id, BigDecimal amount);
    }

    public static final class SystemClock implements Clock {
        @Override
        public Instant now() {
            return Instant.now();
        }
    }

    public static final class InMemoryOrderRepository implements OrderRepository {
        private record PlacedOrder(BigDecimal total, Instant placedAt) {}

        private final Map<String, PlacedOrder> rows = new HashMap<>();

        @Override
        public void save(String id, BigDecimal total, Instant placedAt) {
            rows.put(id, new PlacedOrder(total, placedAt));
        }
    }

    public static final class HttpPaymentGateway implements PaymentGateway {
        private final String baseUrl;

        public HttpPaymentGateway(String baseUrl) {
            this.baseUrl = baseUrl;
        }

        @Override
        public void charge(String id, BigDecimal amount) {
            if (baseUrl == null || baseUrl.isBlank()) {
                throw new IllegalArgumentException("payment base URL is required");
            }
            if (amount.signum() <= 0) {
                throw new IllegalArgumentException("amount must be positive");
            }
            // Call the provider here; the domain never sees its SDK.
        }
    }

    public static final class PlaceOrder {
        private final Clock clock;
        private final OrderRepository orders;
        private final PaymentGateway payments;

        public PlaceOrder(Clock clock, OrderRepository orders, PaymentGateway payments) {
            this.clock = clock;
            this.orders = orders;
            this.payments = payments;
        }

        public void execute(String id, BigDecimal total) {
            if (total.signum() <= 0) {
                throw new IllegalArgumentException("total must be positive");
            }
            payments.charge(id, total);
            orders.save(id, total, clock.now());
        }
    }

    public static PlaceOrder create(String baseUrl) {
        return new PlaceOrder(new SystemClock(), new InMemoryOrderRepository(), new HttpPaymentGateway(baseUrl));
    }
}
