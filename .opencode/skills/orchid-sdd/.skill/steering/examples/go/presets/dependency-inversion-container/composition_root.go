// Placement (illustrative):
//   internal/application/place_order.go        -> PlaceOrder
//   internal/ports/clock.go                    -> Clock
//   internal/ports/order_repository.go         -> OrderRepository
//   internal/ports/payment_gateway.go          -> PaymentGateway
//   internal/infrastructure/system_clock.go    -> SystemClock
//   internal/infrastructure/in_memory_order_repository.go -> InMemoryOrderRepository
//   internal/infrastructure/http_payment_gateway.go -> HttpPaymentGateway
//   internal/composition_root.go               -> composition root

package di

import (
	"context"
	"errors"
	"time"
)

type Clock interface {
	Now() time.Time
}

type OrderRepository interface {
	Save(ctx context.Context, orderID string, total int64, placedAt time.Time) error
}

type PaymentGateway interface {
	Charge(ctx context.Context, orderID string, amount int64) error
}

type SystemClock struct{}

func (SystemClock) Now() time.Time {
	return time.Now().UTC()
}

type storedOrder struct {
	total    int64
	placedAt time.Time
}

type InMemoryOrderRepository struct {
	rows map[string]storedOrder
}

func NewInMemoryOrderRepository() *InMemoryOrderRepository {
	return &InMemoryOrderRepository{rows: make(map[string]storedOrder)}
}

func (r *InMemoryOrderRepository) Save(_ context.Context, orderID string, total int64, placedAt time.Time) error {
	r.rows[orderID] = storedOrder{total: total, placedAt: placedAt}
	return nil
}

type HTTPPaymentGateway struct {
	baseURL string
}

func (g HTTPPaymentGateway) Charge(_ context.Context, _ string, amount int64) error {
	if g.baseURL == "" {
		return errors.New("payment base URL is required")
	}
	if amount <= 0 {
		return errors.New("amount must be positive")
	}
	return nil
}

type PlaceOrder struct {
	clock    Clock
	orders   OrderRepository
	payments PaymentGateway
}

func NewPlaceOrder(clock Clock, orders OrderRepository, payments PaymentGateway) *PlaceOrder {
	return &PlaceOrder{clock: clock, orders: orders, payments: payments}
}

func (s *PlaceOrder) Execute(ctx context.Context, id string, total int64) error {
	if total <= 0 {
		return errors.New("total must be positive")
	}
	if err := s.payments.Charge(ctx, id, total); err != nil {
		return err
	}
	return s.orders.Save(ctx, id, total, s.clock.Now())
}

func CompositionRoot(baseURL string) *PlaceOrder {
	return NewPlaceOrder(SystemClock{}, NewInMemoryOrderRepository(), HTTPPaymentGateway{baseURL: baseURL})
}
