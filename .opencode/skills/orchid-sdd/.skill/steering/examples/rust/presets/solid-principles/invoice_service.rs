// Placement (illustrative):
//   src/domain/invoice_line.rs                 -> InvoiceLine
//   src/application/invoice_service.rs         -> InvoiceService
//   src/ports/invoice_repository.rs            -> InvoiceRepository
//   src/ports/tax_calculator.rs                -> TaxCalculator
//   src/infrastructure/flat_tax_calculator.rs  -> FlatTaxCalculator

#[derive(Debug, Clone)]
pub struct InvoiceLine {
    pub description: String,
    pub amount: i64,
}

#[derive(Debug)]
pub enum InvoiceError {
    Empty,
    InvalidTotal,
    Repository(String),
}

pub trait InvoiceRepository {
    fn save(&self, invoice_id: &str, total: i64) -> Result<(), InvoiceError>;
}

pub trait TaxCalculator {
    fn tax_for(&self, amount: i64) -> i64;
}

pub struct InvoiceService<I, T> {
    invoices: I,
    tax: T,
}

impl<I: InvoiceRepository, T: TaxCalculator> InvoiceService<I, T> {
    pub fn new(invoices: I, tax: T) -> Self {
        Self { invoices, tax }
    }

    pub fn issue(&self, invoice_id: &str, lines: &[InvoiceLine]) -> Result<i64, InvoiceError> {
        if lines.is_empty() {
            return Err(InvoiceError::Empty);
        }

        let subtotal: i64 = lines.iter().map(|line| line.amount).sum();
        if subtotal <= 0 {
            return Err(InvoiceError::InvalidTotal);
        }

        let total = subtotal + self.tax.tax_for(subtotal);
        self.invoices.save(invoice_id, total)?;
        Ok(total)
    }
}

pub struct FlatTaxCalculator {
    pub rate_percent: i64,
}

impl TaxCalculator for FlatTaxCalculator {
    fn tax_for(&self, amount: i64) -> i64 {
        amount * self.rate_percent / 100
    }
}
