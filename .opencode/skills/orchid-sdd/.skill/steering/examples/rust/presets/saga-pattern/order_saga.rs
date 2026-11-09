// Placement (illustrative):
//   src/application/place_order_saga.rs        -> PlaceOrderSaga
//   src/ports/stock_service.rs                 -> StockService
//   src/ports/payment_service.rs               -> PaymentService
//   src/ports/saga_store.rs                    -> SagaStore

#[derive(Debug)]
pub enum SagaError {
    InvalidAmount,
    Step(String),
    Compensation {
        original: String,
        failures: Vec<String>,
    },
}

pub trait StockService {
    fn reserve(&self, order_id: &str, idempotency_key: &str) -> Result<(), SagaError>;
    fn release(&self, order_id: &str, idempotency_key: &str) -> Result<(), SagaError>;
}

pub trait PaymentService {
    fn charge(
        &self,
        order_id: &str,
        amount: i64,
        idempotency_key: &str,
    ) -> Result<(), SagaError>;
    fn refund(
        &self,
        order_id: &str,
        amount: i64,
        idempotency_key: &str,
    ) -> Result<(), SagaError>;
}

pub trait SagaStore {
    fn save(&self, order_id: &str, state: &str) -> Result<(), SagaError>;
}

pub struct PlaceOrderSaga<S, P, T> {
    stock: S,
    payments: P,
    store: T,
}

impl<S: StockService, P: PaymentService, T: SagaStore> PlaceOrderSaga<S, P, T> {
    pub fn new(stock: S, payments: P, store: T) -> Self {
        Self {
            stock,
            payments,
            store,
        }
    }

    pub fn execute(
        &self,
        order_id: &str,
        amount: i64,
        idempotency_key: &str,
    ) -> Result<(), SagaError> {
        if amount <= 0 {
            return Err(SagaError::InvalidAmount);
        }

        self.store.save(order_id, "started")?;
        self.stock
            .reserve(order_id, &format!("{idempotency_key}:stock"))?;
        self.store.save(order_id, "stock_reserved")?;

        match self
            .payments
            .charge(order_id, amount, &format!("{idempotency_key}:payment"))
        {
            Ok(()) => {
                self.store.save(order_id, "completed")?;
                Ok(())
            }
            Err(error) => {
                let mut failures = Vec::new();
                if let Err(compensation) = self
                    .payments
                    .refund(order_id, amount, &format!("{idempotency_key}:refund"))
                {
                    failures.push(format!("{compensation:?}"));
                }
                if let Err(compensation) = self
                    .stock
                    .release(order_id, &format!("{idempotency_key}:release"))
                {
                    failures.push(format!("{compensation:?}"));
                }
                if let Err(compensation) = self.store.save(order_id, "compensated") {
                    failures.push(format!("{compensation:?}"));
                }

                if failures.is_empty() {
                    Err(error)
                } else {
                    Err(SagaError::Compensation {
                        original: format!("{error:?}"),
                        failures,
                    })
                }
            }
        }
    }
}
