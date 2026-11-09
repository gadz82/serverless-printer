// Placement (illustrative):
//   src/application/PlaceOrderSaga.java        -> PlaceOrderSaga
//   src/ports/StockService.java                -> StockService
//   src/ports/PaymentService.java              -> PaymentService
//   src/ports/SagaStore.java                   -> SagaStore

import java.math.BigDecimal;

public final class OrderSaga {
    public interface StockService {
        void reserve(String orderId, String idempotencyKey);
        void release(String orderId, String idempotencyKey);
    }

    public interface PaymentService {
        void charge(String orderId, BigDecimal amount, String idempotencyKey);
        void refund(String orderId, BigDecimal amount, String idempotencyKey);
    }

    public interface SagaStore {
        void save(String orderId, String state);
    }

    private final StockService stock;
    private final PaymentService payments;
    private final SagaStore store;

    public OrderSaga(StockService stock, PaymentService payments, SagaStore store) {
        this.stock = stock;
        this.payments = payments;
        this.store = store;
    }

    public void execute(String orderId, BigDecimal amount, String idempotencyKey) {
        if (amount.signum() <= 0) {
            throw new IllegalArgumentException("amount must be positive");
        }
        store.save(orderId, "started");
        stock.reserve(orderId, idempotencyKey + ":stock");
        store.save(orderId, "stock_reserved");
        try {
            payments.charge(orderId, amount, idempotencyKey + ":payment");
            store.save(orderId, "completed");
        } catch (RuntimeException error) {
            try {
                payments.refund(orderId, amount, idempotencyKey + ":refund");
            } catch (RuntimeException compensation) {
                error.addSuppressed(compensation);
            }
            try {
                stock.release(orderId, idempotencyKey + ":release");
            } catch (RuntimeException compensation) {
                error.addSuppressed(compensation);
            }
            store.save(orderId, "compensated");
            throw error;
        }
    }
}
