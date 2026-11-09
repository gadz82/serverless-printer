# frozen_string_literal: true

# Placement (illustrative):
#   lib/domain/events/order_placed.rb          -> OrderPlaced
#   lib/application/order_event_publisher.rb   -> OrderEventPublisher
#   lib/application/order_projection_consumer.rb -> OrderProjectionConsumer
#   lib/ports/event_publisher.rb               -> EventPublisher
#   lib/ports/processed_event_store.rb         -> ProcessedEventStore

OrderPlaced = Struct.new(:event_id, :order_id, :total, :version, keyword_init: true)

class OrderEventPublisher
  def initialize(publisher:)
    @publisher = publisher
  end

  def call(order_id:, total:, event_id:)
    raise ArgumentError, "total must be positive" if total <= 0

    @publisher.publish(
      OrderPlaced.new(event_id: event_id, order_id: order_id, total: total, version: 1)
    )
  end
end

class OrderProjectionConsumer
  def initialize(processed:, project:)
    @processed = processed
    @project = project
  end

  def call(event)
    return :duplicate if @processed.include?(event.event_id)

    @project.call(event)
    @processed.mark(event.event_id)
    :processed
  end
end
