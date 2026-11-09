// Placement (illustrative):
//   src/domain/order/Order.java                -> Order
//   src/domain/order/OrderLine.java            -> OrderLine
//   src/domain/order/OrderPlaced.java          -> OrderPlaced
//   src/domain/OrderRepository.java            -> OrderRepository

import java.math.BigDecimal;
import java.util.ArrayList;
import java.util.List;

public final class OrderAggregate {
    public record OrderLine(String sku, int quantity, BigDecimal unitPrice) {}
    public record OrderPlaced(String orderId, BigDecimal total) {}

    private final String id;
    private final List<OrderLine> lines;
    private final BigDecimal total;
    private final List<OrderPlaced> events = new ArrayList<>();

    private OrderAggregate(String id, List<OrderLine> lines, BigDecimal total) {
        this.id = id;
        this.lines = List.copyOf(lines);
        this.total = total;
    }

    public static OrderAggregate place(String id, List<OrderLine> lines) {
        if (lines.isEmpty()) {
            throw new IllegalArgumentException("order requires at least one line");
        }
        if (lines.stream().anyMatch(line -> line.quantity() <= 0)) {
            throw new IllegalArgumentException("quantity must be positive");
        }
        BigDecimal total = lines.stream()
            .map(line -> line.unitPrice().multiply(BigDecimal.valueOf(line.quantity())))
            .reduce(BigDecimal.ZERO, BigDecimal::add);
        OrderAggregate order = new OrderAggregate(id, lines, total);
        order.events.add(new OrderPlaced(id, total));
        return order;
    }

    public List<OrderPlaced> pullEvents() {
        List<OrderPlaced> pending = List.copyOf(events);
        events.clear();
        return pending;
    }

    public interface OrderRepository {
        void save(OrderAggregate order);
    }
}
