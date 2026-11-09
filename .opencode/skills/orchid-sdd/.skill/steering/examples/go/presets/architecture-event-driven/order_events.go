// Placement (illustrative):
//   internal/domain/events/order_placed.go     -> OrderPlaced
//   internal/application/order_event_publisher.go -> OrderEventPublisher
//   internal/application/order_projection_consumer.go -> OrderProjectionConsumer
//   internal/ports/event_publisher.go          -> EventPublisher
//   internal/ports/processed_event_store.go    -> ProcessedEventStore

package events

import (
	"context"
	"errors"
)

type OrderPlaced struct {
	EventID string
	OrderID string
	Total   int64
	Version int
}

type EventPublisher interface {
	Publish(ctx context.Context, event OrderPlaced) error
}

type ProcessedEventStore interface {
	Has(ctx context.Context, eventID string) (bool, error)
	Mark(ctx context.Context, eventID string) error
}

type Projection func(context.Context, OrderPlaced) error

type OrderEventPublisher struct {
	publisher EventPublisher
}

func NewOrderEventPublisher(publisher EventPublisher) *OrderEventPublisher {
	return &OrderEventPublisher{publisher: publisher}
}

func (p *OrderEventPublisher) Publish(ctx context.Context, eventID, orderID string, total int64) error {
	if total <= 0 {
		return errors.New("total must be positive")
	}
	return p.publisher.Publish(ctx, OrderPlaced{
		EventID: eventID,
		OrderID: orderID,
		Total:   total,
		Version: 1,
	})
}

type OrderProjectionConsumer struct {
	processed ProcessedEventStore
	project   Projection
}

func NewOrderProjectionConsumer(processed ProcessedEventStore, project Projection) *OrderProjectionConsumer {
	return &OrderProjectionConsumer{processed: processed, project: project}
}

func (c *OrderProjectionConsumer) Handle(ctx context.Context, event OrderPlaced) (string, error) {
	seen, err := c.processed.Has(ctx, event.EventID)
	if err != nil {
		return "", err
	}
	if seen {
		return "duplicate", nil
	}
	if err := c.project(ctx, event); err != nil {
		return "", err
	}
	if err := c.processed.Mark(ctx, event.EventID); err != nil {
		return "", err
	}
	return "processed", nil
}
