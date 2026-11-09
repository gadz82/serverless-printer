// Placement (illustrative):
//   src/domain/order/order.rs                  -> Order
//   src/domain/order/order_line.rs             -> OrderLine
//   src/domain/order/order_placed.rs           -> OrderPlaced
//   src/domain/order_repository.rs             -> OrderRepository

#[derive(Debug, Clone)]
pub struct OrderLine {
    pub sku: String,
    pub quantity: u32,
    pub unit_price: i64,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct OrderPlaced {
    pub order_id: String,
    pub total: i64,
}

#[derive(Debug)]
pub enum OrderError {
    EmptyOrder,
    InvalidQuantity,
}

#[derive(Debug)]
pub struct Order {
    pub id: String,
    pub lines: Vec<OrderLine>,
    pub total: i64,
    events: Vec<OrderPlaced>,
}

impl Order {
    pub fn place(id: &str, lines: Vec<OrderLine>) -> Result<Self, OrderError> {
        if lines.is_empty() {
            return Err(OrderError::EmptyOrder);
        }

        let mut total = 0i64;
        for line in &lines {
            if line.quantity == 0 {
                return Err(OrderError::InvalidQuantity);
            }
            total += i64::from(line.quantity) * line.unit_price;
        }

        Ok(Self {
            id: id.to_string(),
            lines,
            total,
            events: vec![OrderPlaced {
                order_id: id.to_string(),
                total,
            }],
        })
    }

    pub fn pull_events(&mut self) -> Vec<OrderPlaced> {
        std::mem::take(&mut self.events)
    }
}

pub trait OrderRepository {
    fn save(&self, order: &Order) -> Result<(), OrderError>;
}
