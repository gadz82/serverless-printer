// Placement (illustrative):
//   internal/domain/order.go                   -> Order
//   internal/application/confirm_order.go      -> ConfirmOrder
//   internal/ports/order_repository.go         -> OrderRepository
//   internal/adapters/in_memory_order_repository.go -> InMemoryOrderRepository

package example

import (
	"context"
	"errors"
)

type Order struct {
	ID        string
	Confirmed bool
}

var ErrOrderNotFound = errors.New("order not found")

type OrderRepository interface {
	Find(ctx context.Context, id string) (*Order, error)
	Save(ctx context.Context, order Order) error
}

type ConfirmOrder struct {
	orders OrderRepository
}

func NewConfirmOrder(orders OrderRepository) *ConfirmOrder {
	return &ConfirmOrder{orders: orders}
}

func (s *ConfirmOrder) Execute(ctx context.Context, id string) (Order, error) {
	order, err := s.orders.Find(ctx, id)
	if err != nil {
		return Order{}, err
	}
	if order == nil {
		return Order{}, ErrOrderNotFound
	}
	if order.Confirmed {
		return *order, nil
	}

	confirmed := *order
	confirmed.Confirmed = true
	if err := s.orders.Save(ctx, confirmed); err != nil {
		return Order{}, err
	}
	return confirmed, nil
}
