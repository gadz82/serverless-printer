// Placement (illustrative):
//   internal/domain/order.go                   -> Order, OrderLine
//   internal/application/place_order.go        -> PlaceOrder
//   internal/ports/order_repository.go         -> OrderRepository
//   internal/ports/payment_gateway.go          -> PaymentGateway

package clean

import (
	"context"
	"errors"
)

type OrderLine struct {
	SKU       string
	Quantity  int
	UnitPrice int64
}

type Order struct {
	ID    string
	Lines []OrderLine
	Total int64
}

var (
	ErrEmptyOrder      = errors.New("order requires at least one line")
	ErrInvalidQuantity = errors.New("quantity must be positive")
	ErrInvalidTotal    = errors.New("order total must be positive")
)

type OrderRepository interface {
	Save(ctx context.Context, order Order) error
}

type PaymentGateway interface {
	Charge(ctx context.Context, orderID string, amount int64) error
}

type PlaceOrder struct {
	orders   OrderRepository
	payments PaymentGateway
}

func NewPlaceOrder(orders OrderRepository, payments PaymentGateway) *PlaceOrder {
	return &PlaceOrder{orders: orders, payments: payments}
}

func (s *PlaceOrder) Execute(ctx context.Context, id string, lines []OrderLine) (Order, error) {
	if len(lines) == 0 {
		return Order{}, ErrEmptyOrder
	}

	var total int64
	for _, line := range lines {
		if line.Quantity <= 0 {
			return Order{}, ErrInvalidQuantity
		}
		total += int64(line.Quantity) * line.UnitPrice
	}
	if total <= 0 {
		return Order{}, ErrInvalidTotal
	}

	order := Order{ID: id, Lines: lines, Total: total}
	if err := s.payments.Charge(ctx, order.ID, order.Total); err != nil {
		return Order{}, err
	}
	if err := s.orders.Save(ctx, order); err != nil {
		return Order{}, err
	}
	return order, nil
}
