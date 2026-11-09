// Placement (illustrative):
//   src/domain/InvoiceLine.java                -> InvoiceLine
//   src/application/InvoiceService.java        -> InvoiceService
//   src/ports/InvoiceRepository.java           -> InvoiceRepository
//   src/ports/TaxCalculator.java               -> TaxCalculator
//   src/infrastructure/FlatTaxCalculator.java  -> FlatTaxCalculator

import java.math.BigDecimal;
import java.util.List;

public final class InvoiceService {
    public record InvoiceLine(String description, BigDecimal amount) {}

    public interface InvoiceRepository {
        void save(String invoiceId, BigDecimal total);
    }

    public interface TaxCalculator {
        BigDecimal taxFor(BigDecimal amount);
    }

    private final InvoiceRepository invoices;
    private final TaxCalculator tax;

    public InvoiceService(InvoiceRepository invoices, TaxCalculator tax) {
        this.invoices = invoices;
        this.tax = tax;
    }

    public BigDecimal issue(String invoiceId, List<InvoiceLine> lines) {
        if (lines.isEmpty()) {
            throw new IllegalArgumentException("invoice requires at least one line");
        }
        BigDecimal subtotal = lines.stream()
            .map(InvoiceLine::amount)
            .reduce(BigDecimal.ZERO, BigDecimal::add);
        if (subtotal.signum() <= 0) {
            throw new IllegalArgumentException("invoice total must be positive");
        }
        BigDecimal total = subtotal.add(tax.taxFor(subtotal));
        invoices.save(invoiceId, total);
        return total;
    }

    public static final class FlatTaxCalculator implements TaxCalculator {
        private final BigDecimal rate;

        public FlatTaxCalculator(BigDecimal rate) {
            this.rate = rate;
        }

        @Override
        public BigDecimal taxFor(BigDecimal amount) {
            return amount.multiply(rate);
        }
    }
}
