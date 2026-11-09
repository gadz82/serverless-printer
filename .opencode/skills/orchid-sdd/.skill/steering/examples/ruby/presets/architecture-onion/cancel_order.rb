# frozen_string_literal: true

# Placement (illustrative):
#   lib/domain/order.rb                        -> Order
#   lib/domain/order_repository.rb             -> OrderRepository
#   lib/application/cancel_order.rb            -> CancelOrder
#   lib/infrastructure/in_memory_order_repository.rb -> InMemoryOrderRepository

Order = Struct.new(:id, :status, keyword_init: true)

class OrderNotFound < StandardError; end

class CancelOrder
  def initialize(orders:)
    @orders = orders
  end

  def call(order_id:)
    order = @orders.find(order_id)
    raise OrderNotFound, "order not found" unless order
    return order if order.status == "cancelled"

    cancelled = Order.new(id: order.id, status: "cancelled")
    @orders.save(cancelled)
    cancelled
  end
end

class InMemoryOrderRepository
  def initialize
    @rows = {}
  end

  def find(id)
    @rows[id]
  end

  def save(order)
    @rows[order.id] = order
  end
end
