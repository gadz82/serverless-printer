# frozen_string_literal: true

# Placement (illustrative):
#   lib/domain/order_line.rb                   -> OrderLine
#   lib/application/commands/place_order.rb    -> PlaceOrder, PlaceOrderHandler
#   lib/application/queries/order_summary.rb   -> OrderSummary, OrderSummaryReader, GetOrderSummary

OrderLine = Struct.new(:sku, :quantity, :unit_price, keyword_init: true)
PlaceOrder = Struct.new(:order_id, :lines, keyword_init: true)
OrderSummary = Struct.new(:order_id, :line_count, :total, keyword_init: true)

class OrderSummaryNotFound < StandardError; end

class PlaceOrderHandler
  def initialize(writer:)
    @writer = writer
  end

  def call(command)
    raise ArgumentError, "order requires at least one line" if command.lines.empty?

    @writer.save(command)
  end
end

class GetOrderSummary
  def initialize(reader:)
    @reader = reader
  end

  def call(order_id)
    summary = @reader.by_id(order_id)
    raise OrderSummaryNotFound, "order summary not found" unless summary

    summary
  end
end
