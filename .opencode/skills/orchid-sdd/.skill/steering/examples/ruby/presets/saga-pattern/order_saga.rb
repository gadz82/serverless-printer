# frozen_string_literal: true

# Placement (illustrative):
#   lib/application/place_order_saga.rb        -> PlaceOrderSaga
#   lib/ports/stock_service.rb                 -> StockService
#   lib/ports/payment_service.rb               -> PaymentService
#   lib/ports/saga_store.rb                    -> SagaStore

class PlaceOrderSaga
  def initialize(stock:, payments:, store:)
    @stock = stock
    @payments = payments
    @store = store
  end

  def call(order_id:, amount:, idempotency_key:)
    raise ArgumentError, "amount must be positive" if amount <= 0

    @store.save(order_id, "started")
    @stock.reserve(order_id, "#{idempotency_key}:stock")
    @store.save(order_id, "stock_reserved")

    begin
      @payments.charge(order_id, amount, "#{idempotency_key}:payment")
      @store.save(order_id, "completed")
    rescue StandardError => error
      compensate(order_id, amount, idempotency_key)
      raise error
    end
  end

  private

  def compensate(order_id, amount, idempotency_key)
    failures = []
    begin
      @payments.refund(order_id, amount, "#{idempotency_key}:refund")
    rescue StandardError => error
      failures << error
    end
    begin
      @stock.release(order_id, "#{idempotency_key}:release")
    rescue StandardError => error
      failures << error
    end
    @store.save(order_id, "compensated")
    return if failures.empty?

    raise "saga compensation incomplete: #{failures.map(&:message).join(', ')}"
  end
end
