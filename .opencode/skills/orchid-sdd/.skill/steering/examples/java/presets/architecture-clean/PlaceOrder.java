// Placement (illustrative):
//   src/domain/Order.java                      -> Order, OrderLine
//   src/application/PlaceOrder.java            -> PlaceOrder
//   src/ports/OrderRepository.java             -> OrderRepository
//   src/ports/PaymentGateway.java              -> PaymentGateway

import java.math.BigDecimal;
import java.util.List;

public final class PlaceOrder {
    public record OrderLine(String sku, int quantity, BigDecimal unitPrice) {}
    public record Order(String id, List<OrderLine> lines, BigDecimal total) {}

    public interface OrderRepository {
        void save(Order order);
    }

    public interface PaymentGateway {
        void charge(String orderId, BigDecimal amount);
    }

    private final OrderRepository orders;
    private final PaymentGateway payments;

    public PlaceOrder(OrderRepository orders, PaymentGateway payments) {
        this.orders = orders;
        this.payments = payments;
    }

    public Order execute(String id, List<OrderLine> lines) {
        if (lines.isEmpty()) {
            throw new IllegalArgumentException("order requires at least one line");
        }
        BigDecimal total = lines.stream()
            .map(line -> line.unitPrice().multiply(BigDecimal.valueOf(line.quantity())))
            .reduce(BigDecimal.ZERO, BigDecimal::add);
        if (total.signum() <= 0) {
            throw new IllegalArgumentException("order total must be positive");
        }
        Order order = new Order(id, List.copyOf(lines), total);
        payments.charge(order.id(), order.total());
        orders.save(order);
        return order;
    }
}
