# frozen_string_literal: true

# Placement (illustrative):
#   lib/application/place_order.rb             -> PlaceOrder
#   lib/ports/clock.rb                         -> Clock
#   lib/ports/order_repository.rb              -> OrderRepository
#   lib/ports/payment_gateway.rb               -> PaymentGateway
#   lib/infrastructure/system_clock.rb         -> SystemClock
#   lib/infrastructure/in_memory_order_repository.rb -> InMemoryOrderRepository
#   lib/infrastructure/http_payment_gateway.rb -> HttpPaymentGateway
#   lib/composition_root.rb                    -> composition root

class PlaceOrder
  def initialize(clock:, orders:, payments:)
    @clock = clock
    @orders = orders
    @payments = payments
  end

  def call(id:, total:)
    raise ArgumentError, "total must be positive" if total <= 0

    @payments.charge(order_id: id, amount: total)
    @orders.save(id, total, @clock.now)
  end
end

class SystemClock
  def now
    Time.now.utc
  end
end

class InMemoryOrderRepository
  def initialize
    @rows = {}
  end

  def save(order_id, total, placed_at)
    @rows[order_id] = { total: total, placed_at: placed_at }
  end
end

class HttpPaymentGateway
  def initialize(base_url:)
    @base_url = base_url
  end

  def charge(order_id:, amount:)
    raise ArgumentError, "payment base URL is required" if @base_url.to_s.empty?
    raise ArgumentError, "amount must be positive" if amount <= 0

    # Call the provider here; the domain never sees its SDK.
  end
end

def composition_root(base_url:)
  PlaceOrder.new(
    clock: SystemClock.new,
    orders: InMemoryOrderRepository.new,
    payments: HttpPaymentGateway.new(base_url: base_url)
  )
end
