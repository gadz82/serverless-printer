// Placement (illustrative):
//   internal/domain/order.go                   -> Order
//   internal/domain/order_repository.go        -> OrderRepository
//   internal/application/cancel_order.go       -> CancelOrder
//   internal/infrastructure/in_memory_order_repository.go -> InMemoryOrderRepository

package onion

import (
	"context"
	"errors"
)

type Order struct {
	ID     string
	Status string
}

var ErrOrderNotFound = errors.New("order not found")

type OrderRepository interface {
	Find(ctx context.Context, id string) (*Order, error)
	Save(ctx context.Context, order Order) error
}

type CancelOrder struct {
	orders OrderRepository
}

func NewCancelOrder(orders OrderRepository) *CancelOrder {
	return &CancelOrder{orders: orders}
}

func (s *CancelOrder) Execute(ctx context.Context, id string) (Order, error) {
	order, err := s.orders.Find(ctx, id)
	if err != nil {
		return Order{}, err
	}
	if order == nil {
		return Order{}, ErrOrderNotFound
	}
	if order.Status == "cancelled" {
		return *order, nil
	}

	cancelled := *order
	cancelled.Status = "cancelled"
	if err := s.orders.Save(ctx, cancelled); err != nil {
		return Order{}, err
	}
	return cancelled, nil
}
