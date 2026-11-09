// Placement (illustrative):
//   internal/domain/order_line.go              -> OrderLine
//   internal/application/commands/place_order.go -> PlaceOrder, PlaceOrderHandler
//   internal/application/queries/order_summary.go -> OrderSummary, OrderSummaryReader, GetOrderSummary

package cqrs

import (
	"context"
	"errors"
)

type OrderLine struct {
	SKU       string
	Quantity  int
	UnitPrice int64
}

type PlaceOrder struct {
	OrderID string
	Lines   []OrderLine
}

type OrderSummary struct {
	OrderID   string
	LineCount int
	Total     int64
}

var ErrOrderSummaryNotFound = errors.New("order summary not found")

type OrderWriter interface {
	Save(ctx context.Context, command PlaceOrder) error
}

type OrderSummaryReader interface {
	ByID(ctx context.Context, orderID string) (*OrderSummary, error)
}

type PlaceOrderHandler struct {
	writer OrderWriter
}

func NewPlaceOrderHandler(writer OrderWriter) *PlaceOrderHandler {
	return &PlaceOrderHandler{writer: writer}
}

func (h *PlaceOrderHandler) Execute(ctx context.Context, command PlaceOrder) error {
	if len(command.Lines) == 0 {
		return errors.New("order requires at least one line")
	}
	return h.writer.Save(ctx, command)
}

type GetOrderSummary struct {
	reader OrderSummaryReader
}

func NewGetOrderSummary(reader OrderSummaryReader) *GetOrderSummary {
	return &GetOrderSummary{reader: reader}
}

func (q *GetOrderSummary) Execute(ctx context.Context, orderID string) (OrderSummary, error) {
	summary, err := q.reader.ByID(ctx, orderID)
	if err != nil {
		return OrderSummary{}, err
	}
	if summary == nil {
		return OrderSummary{}, ErrOrderSummaryNotFound
	}
	return *summary, nil
}
