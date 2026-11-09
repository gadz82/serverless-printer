# frozen_string_literal: true

# Placement (illustrative):
#   lib/domain/order/order.rb                  -> Order
#   lib/domain/order/order_line.rb             -> OrderLine
#   lib/domain/order/order_placed.rb           -> OrderPlaced
#   lib/domain/order_repository.rb             -> OrderRepository

OrderLine = Struct.new(:sku, :quantity, :unit_price, keyword_init: true)
OrderPlaced = Struct.new(:order_id, :total, keyword_init: true)

class Order
  attr_reader :id, :lines, :total

  def self.place(id:, lines:)
    raise ArgumentError, "order requires at least one line" if lines.empty?
    raise ArgumentError, "quantity must be positive" if lines.any? { |line| line.quantity <= 0 }

    total = lines.sum { |line| line.quantity * line.unit_price }
    order = new(id: id, lines: lines.freeze, total: total)
    order.record(OrderPlaced.new(order_id: id, total: total))
    order
  end

  def initialize(id:, lines:, total:)
    @id = id
    @lines = lines
    @total = total
    @events = []
  end

  def pull_events
    events = @events.dup
    @events.clear
    events
  end

  private

  def record(event)
    @events << event
  end
end

module OrderRepository
  def save(order)
    raise NotImplementedError, "implement save(order)"
  end
end
