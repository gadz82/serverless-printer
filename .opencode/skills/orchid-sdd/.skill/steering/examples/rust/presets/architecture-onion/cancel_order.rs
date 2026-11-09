// Placement (illustrative):
//   src/domain/order.rs                        -> Order
//   src/domain/order_repository.rs             -> OrderRepository
//   src/application/cancel_order.rs            -> CancelOrder
//   src/infrastructure/in_memory_order_repository.rs -> InMemoryOrderRepository

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Order {
    pub id: String,
    pub status: String,
}

#[derive(Debug)]
pub enum OrderError {
    NotFound,
    Backend(String),
}

pub trait OrderRepository {
    fn find(&self, id: &str) -> Result<Option<Order>, OrderError>;
    fn save(&self, order: &Order) -> Result<(), OrderError>;
}

pub struct CancelOrder<R: OrderRepository> {
    orders: R,
}

impl<R: OrderRepository> CancelOrder<R> {
    pub fn new(orders: R) -> Self {
        Self { orders }
    }

    pub fn execute(&self, id: &str) -> Result<Order, OrderError> {
        let order = self.orders.find(id)?.ok_or(OrderError::NotFound)?;
        if order.status == "cancelled" {
            return Ok(order);
        }

        let cancelled = Order {
            id: order.id,
            status: "cancelled".to_string(),
        };
        self.orders.save(&cancelled)?;
        Ok(cancelled)
    }
}
