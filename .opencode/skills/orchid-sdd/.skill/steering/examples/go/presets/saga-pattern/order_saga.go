// Placement (illustrative):
//   internal/application/place_order_saga.go   -> PlaceOrderSaga
//   internal/ports/stock_service.go            -> StockService
//   internal/ports/payment_service.go          -> PaymentService
//   internal/ports/saga_store.go               -> SagaStore

package saga

import (
	"context"
	"errors"
	"fmt"
)

type StockService interface {
	Reserve(ctx context.Context, orderID, idempotencyKey string) error
	Release(ctx context.Context, orderID, idempotencyKey string) error
}

type PaymentService interface {
	Charge(ctx context.Context, orderID string, amount int64, idempotencyKey string) error
	Refund(ctx context.Context, orderID string, amount int64, idempotencyKey string) error
}

type SagaStore interface {
	Save(ctx context.Context, orderID, state string) error
}

type PlaceOrderSaga struct {
	stock    StockService
	payments PaymentService
	store    SagaStore
}

func NewPlaceOrderSaga(stock StockService, payments PaymentService, store SagaStore) *PlaceOrderSaga {
	return &PlaceOrderSaga{stock: stock, payments: payments, store: store}
}

func (s *PlaceOrderSaga) Execute(ctx context.Context, orderID string, amount int64, idempotencyKey string) error {
	if amount <= 0 {
		return errors.New("amount must be positive")
	}
	if err := s.store.Save(ctx, orderID, "started"); err != nil {
		return err
	}
	if err := s.stock.Reserve(ctx, orderID, idempotencyKey+":stock"); err != nil {
		return err
	}
	if err := s.store.Save(ctx, orderID, "stock_reserved"); err != nil {
		return err
	}

	if err := s.payments.Charge(ctx, orderID, amount, idempotencyKey+":payment"); err != nil {
		var failures []error
		if compensationErr := s.payments.Refund(ctx, orderID, amount, idempotencyKey+":refund"); compensationErr != nil {
			failures = append(failures, compensationErr)
		}
		if compensationErr := s.stock.Release(ctx, orderID, idempotencyKey+":release"); compensationErr != nil {
			failures = append(failures, compensationErr)
		}
		if compensationErr := s.store.Save(ctx, orderID, "compensated"); compensationErr != nil {
			failures = append(failures, compensationErr)
		}
		if len(failures) > 0 {
			return errors.Join(append([]error{fmt.Errorf("charge failed: %w", err)}, failures...)...)
		}
		return err
	}

	return s.store.Save(ctx, orderID, "completed")
}
