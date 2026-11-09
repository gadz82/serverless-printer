// Placement (illustrative):
//   src/domain/invoice-line.ts                 -> InvoiceLine
//   src/application/invoice-service.ts         -> InvoiceService
//   src/ports/invoice-repository.ts            -> InvoiceRepository
//   src/ports/tax-calculator.ts                -> TaxCalculator
//   src/infrastructure/flat-tax-calculator.ts  -> FlatTaxCalculator

// SOLID: one responsibility per unit, consumer-shaped contracts, explicit dependencies.
export type InvoiceLine = {
  readonly description: string;
  readonly amount: number;
};

export interface InvoiceRepository {
  save(invoiceId: string, total: number): Promise<void>;
}

export interface TaxCalculator {
  taxFor(amount: number): number;
}

export class InvoiceService {
  constructor(
    private readonly invoices: InvoiceRepository,
    private readonly tax: TaxCalculator,
  ) {}

  async issue(invoiceId: string, lines: readonly InvoiceLine[]): Promise<number> {
    if (lines.length === 0) throw new Error("invoice requires at least one line");
    const subtotal = lines.reduce((sum, line) => sum + line.amount, 0);
    if (subtotal <= 0) throw new Error("invoice total must be positive");
    const total = subtotal + this.tax.taxFor(subtotal);
    await this.invoices.save(invoiceId, total);
    return total;
  }
}

export class FlatTaxCalculator implements TaxCalculator {
  constructor(private readonly rate: number) {}

  taxFor(amount: number): number {
    return amount * this.rate;
  }
}
