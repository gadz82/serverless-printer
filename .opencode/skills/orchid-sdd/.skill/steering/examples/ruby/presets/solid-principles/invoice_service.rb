# frozen_string_literal: true

# Placement (illustrative):
#   lib/domain/invoice_line.rb                 -> InvoiceLine
#   lib/application/invoice_service.rb         -> InvoiceService
#   lib/ports/invoice_repository.rb            -> InvoiceRepository
#   lib/ports/tax_calculator.rb                -> TaxCalculator
#   lib/infrastructure/flat_tax_calculator.rb  -> FlatTaxCalculator

InvoiceLine = Struct.new(:description, :amount, keyword_init: true)

class InvoiceService
  def initialize(invoices:, tax:)
    @invoices = invoices
    @tax = tax
  end

  def call(invoice_id:, lines:)
    raise ArgumentError, "invoice requires at least one line" if lines.empty?

    subtotal = lines.sum(&:amount)
    raise ArgumentError, "invoice total must be positive" if subtotal <= 0

    total = subtotal + @tax.tax_for(subtotal)
    @invoices.save(invoice_id, total)
    total
  end
end

class FlatTaxCalculator
  def initialize(rate:)
    @rate = rate
  end

  def tax_for(amount)
    amount * @rate
  end
end
