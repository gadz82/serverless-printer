# frozen_string_literal: true

# Placement (illustrative):
#   lib/domain/order.rb                        -> Order, OrderLine
#   lib/application/place_order.rb             -> PlaceOrder
#   lib/ports/order_repository.rb              -> OrderRepository
#   lib/ports/payment_gateway.rb               -> PaymentGateway

OrderLine = Struct.new(:sku, :quantity, :unit_price, keyword_init: true)
Order = Struct.new(:id, :lines, :total, keyword_init: true)

class PlaceOrder
  def initialize(orders:, payments:)
    @orders = orders
    @payments = payments
  end

  def call(id:, lines:)
    raise ArgumentError, "order requires at least one line" if lines.empty?

    total = lines.sum { |line| line.quantity * line.unit_price }
    raise ArgumentError, "order total must be positive" if total <= 0

    order = Order.new(id: id, lines: lines.freeze, total: total)
    @payments.charge(order_id: order.id, amount: order.total)
    @orders.save(order)
    order
  end
end
