// Placement (illustrative):
//   src/domain/Order.java                      -> Order
//   src/application/ConfirmOrder.java          -> ConfirmOrder
//   src/ports/OrderRepository.java             -> OrderRepository
//   src/adapters/InMemoryOrderRepository.java  -> InMemoryOrderRepository

import java.util.HashMap;
import java.util.Map;
import java.util.Optional;

public final class ConfirmOrder {
    public record Order(String id, boolean confirmed) {}

    public interface OrderRepository {
        Optional<Order> find(String id);
        void save(Order order);
    }

    private final OrderRepository orders;

    public ConfirmOrder(OrderRepository orders) {
        this.orders = orders;
    }

    public Order execute(String orderId) {
        Order order = orders.find(orderId)
            .orElseThrow(() -> new IllegalArgumentException("order not found"));
        if (order.confirmed()) {
            return order;
        }
        Order confirmed = new Order(order.id(), true);
        orders.save(confirmed);
        return confirmed;
    }

    public static final class InMemoryOrderRepository implements OrderRepository {
        private final Map<String, Order> orders = new HashMap<>();

        @Override
        public Optional<Order> find(String id) {
            return Optional.ofNullable(orders.get(id));
        }

        @Override
        public void save(Order order) {
            orders.put(order.id(), order);
        }
    }
}
