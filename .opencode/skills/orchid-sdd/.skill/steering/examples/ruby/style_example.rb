# frozen_string_literal: true

# Placement (illustrative):
#   lib/payments/payment_request.rb            -> PaymentRequest
#   lib/payments/payment_gateway.rb            -> PaymentGateway
#   lib/payments/payment_service.rb            -> PaymentService

PaymentRequest = Struct.new(:order_id, :amount, keyword_init: true)

class PaymentService
  def initialize(gateway)
    @gateway = gateway
  end

  def charge(order_id:, amount:)
    raise ArgumentError, "order_id is required" if order_id.to_s.empty?
    raise ArgumentError, "amount must be positive" if amount <= 0

    # The provider timeout is intentional: a retry must use the same idempotency key.
    @gateway.charge(PaymentRequest.new(order_id: order_id, amount: amount))
  end
end
