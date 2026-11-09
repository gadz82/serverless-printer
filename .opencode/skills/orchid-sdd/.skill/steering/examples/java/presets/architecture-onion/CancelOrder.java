// Placement (illustrative):
//   src/domain/Order.java                      -> Order
//   src/domain/OrderRepository.java            -> OrderRepository
//   src/application/CancelOrder.java           -> CancelOrder
//   src/infrastructure/InMemoryOrderRepository.java -> InMemoryOrderRepository

import java.util.HashMap;
import java.util.Map;
import java.util.Optional;

public final class CancelOrder {
    public record Order(String id, String status) {}

    public interface OrderRepository {
        Optional<Order> find(String id);
        void save(Order order);
    }

    private final OrderRepository orders;

    public CancelOrder(OrderRepository orders) {
        this.orders = orders;
    }

    public Order execute(String id) {
        Order order = orders.find(id)
            .orElseThrow(() -> new IllegalArgumentException("order not found"));
        if ("cancelled".equals(order.status())) {
            return order;
        }
        Order cancelled = new Order(order.id(), "cancelled");
        orders.save(cancelled);
        return cancelled;
    }

    public static final class InMemoryOrderRepository implements OrderRepository {
        private final Map<String, Order> rows = new HashMap<>();

        @Override
        public Optional<Order> find(String id) {
            return Optional.ofNullable(rows.get(id));
        }

        @Override
        public void save(Order order) {
            rows.put(order.id(), order);
        }
    }
}
