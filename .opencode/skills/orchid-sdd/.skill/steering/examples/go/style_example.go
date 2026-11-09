// Placement (illustrative):
//   internal/payments/payment_request.go       -> PaymentRequest
//   internal/payments/payment_gateway.go       -> PaymentGateway
//   internal/payments/payment_service.go       -> PaymentService

package style

import (
	"context"
	"errors"
	"fmt"
)

var ErrPaymentDeclined = errors.New("payment declined")

type PaymentRequest struct {
	OrderID string
	Amount  int64
}

type PaymentGateway interface {
	Charge(ctx context.Context, request PaymentRequest) error
}

type PaymentService struct {
	gateway PaymentGateway
}

func NewPaymentService(gateway PaymentGateway) *PaymentService {
	return &PaymentService{gateway: gateway}
}

func (s *PaymentService) Charge(ctx context.Context, orderID string, amount int64) error {
	if orderID == "" {
		return fmt.Errorf("charge: order id is required")
	}
	if amount <= 0 {
		return fmt.Errorf("charge: amount must be positive: %d", amount)
	}
	// The provider timeout is intentional: a retry must use the same idempotency key.
	if err := s.gateway.Charge(ctx, PaymentRequest{OrderID: orderID, Amount: amount}); err != nil {
		return fmt.Errorf("charge order %s: %w", orderID, err)
	}
	return nil
}
