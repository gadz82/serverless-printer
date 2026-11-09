// Placement (illustrative):
//   src/payments/PaymentRequest.java           -> PaymentRequest
//   src/payments/PaymentGateway.java           -> PaymentGateway
//   src/payments/PaymentService.java           -> PaymentService

import java.math.BigDecimal;

public final class StyleExample {
    public record PaymentRequest(String orderId, BigDecimal amount) {}

    public interface PaymentGateway {
        void charge(PaymentRequest request);
    }

    public static final class PaymentService {
        private final PaymentGateway gateway;

        public PaymentService(PaymentGateway gateway) {
            this.gateway = gateway;
        }

        public void charge(String orderId, BigDecimal amount) {
            if (orderId == null || orderId.isBlank()) {
                throw new IllegalArgumentException("orderId is required");
            }
            if (amount == null || amount.signum() <= 0) {
                throw new IllegalArgumentException("amount must be positive");
            }
            // The provider timeout is intentional: a retry must use the same idempotency key.
            gateway.charge(new PaymentRequest(orderId, amount));
        }
    }
}
