# frozen_string_literal: true

# Placement (illustrative):
#   lib/domain/order.rb                        -> Order
#   lib/application/confirm_order.rb           -> ConfirmOrder
#   lib/ports/order_repository.rb              -> OrderRepository
#   lib/adapters/in_memory_order_repository.rb -> InMemoryOrderRepository

Order = Struct.new(:id, :confirmed, keyword_init: true)

class OrderNotFound < StandardError; end

class ConfirmOrder
  def initialize(orders:)
    @orders = orders
  end

  def call(order_id:)
    order = @orders.find(order_id)
    raise OrderNotFound, "order not found" unless order
    return order if order.confirmed

    confirmed = Order.new(id: order.id, confirmed: true)
    @orders.save(confirmed)
    confirmed
  end
end

class InMemoryOrderRepository
  def initialize
    @orders = {}
  end

  def find(id)
    @orders[id]
  end

  def save(order)
    @orders[order.id] = order
  end
end
