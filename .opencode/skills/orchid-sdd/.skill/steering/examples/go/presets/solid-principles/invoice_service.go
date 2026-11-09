// Placement (illustrative):
//   internal/domain/invoice_line.go            -> InvoiceLine
//   internal/application/invoice_service.go    -> InvoiceService
//   internal/ports/invoice_repository.go       -> InvoiceRepository
//   internal/ports/tax_calculator.go           -> TaxCalculator
//   internal/infrastructure/flat_tax_calculator.go -> FlatTaxCalculator

package solid

import "errors"

type InvoiceLine struct {
	Description string
	Amount      int64
}

type InvoiceRepository interface {
	Save(invoiceID string, total int64) error
}

type TaxCalculator interface {
	TaxFor(amount int64) int64
}

type InvoiceService struct {
	invoices InvoiceRepository
	tax      TaxCalculator
}

func NewInvoiceService(invoices InvoiceRepository, tax TaxCalculator) *InvoiceService {
	return &InvoiceService{invoices: invoices, tax: tax}
}

func (s *InvoiceService) Issue(invoiceID string, lines []InvoiceLine) (int64, error) {
	if len(lines) == 0 {
		return 0, errors.New("invoice requires at least one line")
	}

	var subtotal int64
	for _, line := range lines {
		subtotal += line.Amount
	}
	if subtotal <= 0 {
		return 0, errors.New("invoice total must be positive")
	}

	total := subtotal + s.tax.TaxFor(subtotal)
	if err := s.invoices.Save(invoiceID, total); err != nil {
		return 0, err
	}
	return total, nil
}

type FlatTaxCalculator struct {
	RatePercent int64
}

func (c FlatTaxCalculator) TaxFor(amount int64) int64 {
	return amount * c.RatePercent / 100
}
