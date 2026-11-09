// Placement (illustrative):
//   src/application/place_order.rs             -> PlaceOrder
//   src/ports/clock.rs                         -> Clock
//   src/ports/order_repository.rs              -> OrderRepository
//   src/ports/payment_gateway.rs               -> PaymentGateway
//   src/infrastructure/system_clock.rs         -> SystemClock
//   src/infrastructure/in_memory_order_repository.rs -> InMemoryOrderRepository
//   src/infrastructure/http_payment_gateway.rs -> HttpPaymentGateway
//   src/composition_root.rs                    -> composition root

use std::cell::RefCell;
use std::collections::HashMap;
use std::time::{SystemTime, UNIX_EPOCH};

#[derive(Debug)]
pub enum DiError {
    InvalidAmount,
    MissingBaseUrl,
    Repository(String),
}

pub trait Clock {
    fn now(&self) -> u64;
}

pub trait OrderRepository {
    fn save(&self, order_id: &str, total: i64, placed_at: u64) -> Result<(), DiError>;
}

pub trait PaymentGateway {
    fn charge(&self, order_id: &str, amount: i64) -> Result<(), DiError>;
}

pub struct SystemClock;

impl Clock for SystemClock {
    fn now(&self) -> u64 {
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system clock before Unix epoch")
            .as_secs()
    }
}

pub struct InMemoryOrderRepository {
    rows: RefCell<HashMap<String, (i64, u64)>>,
}

impl InMemoryOrderRepository {
    pub fn new() -> Self {
        Self {
            rows: RefCell::new(HashMap::new()),
        }
    }
}

impl Default for InMemoryOrderRepository {
    fn default() -> Self {
        Self::new()
    }
}

impl OrderRepository for InMemoryOrderRepository {
    fn save(&self, order_id: &str, total: i64, placed_at: u64) -> Result<(), DiError> {
        self.rows
            .borrow_mut()
            .insert(order_id.to_string(), (total, placed_at));
        Ok(())
    }
}

pub struct HttpPaymentGateway {
    base_url: String,
}

impl HttpPaymentGateway {
    pub fn new(base_url: &str) -> Self {
        Self {
            base_url: base_url.to_string(),
        }
    }
}

impl PaymentGateway for HttpPaymentGateway {
    fn charge(&self, _order_id: &str, amount: i64) -> Result<(), DiError> {
        if self.base_url.is_empty() {
            return Err(DiError::MissingBaseUrl);
        }
        if amount <= 0 {
            return Err(DiError::InvalidAmount);
        }
        // Call the provider here; the domain never sees its SDK.
        Ok(())
    }
}

pub struct PlaceOrder<C, O, P> {
    clock: C,
    orders: O,
    payments: P,
}

impl<C: Clock, O: OrderRepository, P: PaymentGateway> PlaceOrder<C, O, P> {
    pub fn new(clock: C, orders: O, payments: P) -> Self {
        Self {
            clock,
            orders,
            payments,
        }
    }

    pub fn execute(&self, order_id: &str, total: i64) -> Result<(), DiError> {
        if total <= 0 {
            return Err(DiError::InvalidAmount);
        }
        self.payments.charge(order_id, total)?;
        self.orders.save(order_id, total, self.clock.now())
    }
}

pub fn composition_root(
    base_url: &str,
) -> PlaceOrder<SystemClock, InMemoryOrderRepository, HttpPaymentGateway> {
    PlaceOrder::new(
        SystemClock,
        InMemoryOrderRepository::new(),
        HttpPaymentGateway::new(base_url),
    )
}
