// Placement (illustrative):
//   src/domain/OrderLine.java                  -> OrderLine
//   src/application/commands/PlaceOrder.java   -> PlaceOrder, PlaceOrderHandler
//   src/application/queries/OrderSummary.java  -> OrderSummary, OrderSummaryReader, GetOrderSummary

import java.math.BigDecimal;
import java.util.List;

public final class Orders {
    public record OrderLine(String sku, int quantity, BigDecimal unitPrice) {}
    public record PlaceOrder(String orderId, List<OrderLine> lines) {}
    public record OrderSummary(String orderId, int lineCount, BigDecimal total) {}

    public interface OrderWriter {
        void save(PlaceOrder command);
    }

    public interface OrderSummaryReader {
        OrderSummary byId(String orderId);
    }

    public static final class PlaceOrderHandler {
        private final OrderWriter writer;

        public PlaceOrderHandler(OrderWriter writer) {
            this.writer = writer;
        }

        public void execute(PlaceOrder command) {
            if (command.lines().isEmpty()) {
                throw new IllegalArgumentException("order requires at least one line");
            }
            writer.save(command);
        }
    }

    public static final class GetOrderSummary {
        private final OrderSummaryReader reader;

        public GetOrderSummary(OrderSummaryReader reader) {
            this.reader = reader;
        }

        public OrderSummary execute(String orderId) {
            OrderSummary summary = reader.byId(orderId);
            if (summary == null) {
                throw new IllegalStateException("order summary not found");
            }
            return summary;
        }
    }
}
