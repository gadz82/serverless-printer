// Placement (illustrative):
//   src/domain/order.rs                        -> Order, OrderLine
//   src/application/place_order.rs             -> PlaceOrder
//   src/ports/order_repository.rs              -> OrderRepository
//   src/ports/payment_gateway.rs               -> PaymentGateway

use std::fmt;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct OrderLine {
    pub sku: String,
    pub quantity: u32,
    pub unit_price: i64,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Order {
    pub id: String,
    pub lines: Vec<OrderLine>,
    pub total: i64,
}

#[derive(Debug, PartialEq, Eq)]
pub enum PlaceOrderError {
    EmptyOrder,
    InvalidQuantity,
    InvalidTotal,
    Payment(String),
    Repository(String),
}

impl fmt::Display for PlaceOrderError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{self:?}")
    }
}

pub trait OrderRepository {
    fn save(&self, order: &Order) -> Result<(), PlaceOrderError>;
}

pub trait PaymentGateway {
    fn charge(&self, order_id: &str, amount: i64) -> Result<(), PlaceOrderError>;
}

pub struct PlaceOrder<R, P> {
    orders: R,
    payments: P,
}

impl<R: OrderRepository, P: PaymentGateway> PlaceOrder<R, P> {
    pub fn new(orders: R, payments: P) -> Self {
        Self { orders, payments }
    }

    pub fn execute(&self, id: &str, lines: Vec<OrderLine>) -> Result<Order, PlaceOrderError> {
        if lines.is_empty() {
            return Err(PlaceOrderError::EmptyOrder);
        }

        let mut total = 0i64;
        for line in &lines {
            if line.quantity == 0 {
                return Err(PlaceOrderError::InvalidQuantity);
            }
            total += i64::from(line.quantity) * line.unit_price;
        }
        if total <= 0 {
            return Err(PlaceOrderError::InvalidTotal);
        }

        let order = Order {
            id: id.to_string(),
            lines,
            total,
        };
        self.payments.charge(&order.id, order.total)?;
        self.orders.save(&order)?;
        Ok(order)
    }
}
