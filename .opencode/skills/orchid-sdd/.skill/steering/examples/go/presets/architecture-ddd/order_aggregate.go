// Placement (illustrative):
//   internal/domain/order/order.go             -> Order
//   internal/domain/order/order_line.go        -> OrderLine
//   internal/domain/order/order_placed.go      -> OrderPlaced
//   internal/domain/order_repository.go        -> OrderRepository

package ddd

import (
	"context"
	"errors"
)

type OrderLine struct {
	SKU       string
	Quantity  int
	UnitPrice int64
}

type OrderPlaced struct {
	OrderID string
	Total   int64
}

type Order struct {
	ID     string
	Lines  []OrderLine
	Total  int64
	events []OrderPlaced
}

var (
	ErrEmptyOrder      = errors.New("order requires at least one line")
	ErrInvalidQuantity = errors.New("quantity must be positive")
)

func Place(id string, lines []OrderLine) (*Order, error) {
	if len(lines) == 0 {
		return nil, ErrEmptyOrder
	}

	var total int64
	for _, line := range lines {
		if line.Quantity <= 0 {
			return nil, ErrInvalidQuantity
		}
		total += int64(line.Quantity) * line.UnitPrice
	}

	order := &Order{ID: id, Lines: lines, Total: total}
	order.events = append(order.events, OrderPlaced{OrderID: id, Total: total})
	return order, nil
}

func (o *Order) PullEvents() []OrderPlaced {
	events := o.events
	o.events = nil
	return events
}

type OrderRepository interface {
	Save(ctx context.Context, order *Order) error
}
