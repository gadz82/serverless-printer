// Placement (illustrative):
//   src/domain/order.rs                        -> Order
//   src/application/confirm_order.rs           -> ConfirmOrder
//   src/ports/order_repository.rs              -> OrderRepository
//   src/adapters/in_memory_order_repository.rs -> InMemoryOrderRepository

use std::cell::RefCell;
use std::collections::HashMap;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Order {
    pub id: String,
    pub confirmed: bool,
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

pub struct ConfirmOrder<R: OrderRepository> {
    orders: R,
}

impl<R: OrderRepository> ConfirmOrder<R> {
    pub fn new(orders: R) -> Self {
        Self { orders }
    }

    pub fn execute(&self, order_id: &str) -> Result<Order, OrderError> {
        let order = self.orders.find(order_id)?.ok_or(OrderError::NotFound)?;
        if order.confirmed {
            return Ok(order);
        }

        let confirmed = Order {
            id: order.id,
            confirmed: true,
        };
        self.orders.save(&confirmed)?;
        Ok(confirmed)
    }
}

pub struct InMemoryOrderRepository {
    orders: RefCell<HashMap<String, Order>>,
}

impl InMemoryOrderRepository {
    pub fn new() -> Self {
        Self {
            orders: RefCell::new(HashMap::new()),
        }
    }
}

impl Default for InMemoryOrderRepository {
    fn default() -> Self {
        Self::new()
    }
}

impl OrderRepository for InMemoryOrderRepository {
    fn find(&self, id: &str) -> Result<Option<Order>, OrderError> {
        Ok(self.orders.borrow().get(id).cloned())
    }

    fn save(&self, order: &Order) -> Result<(), OrderError> {
        self.orders
            .borrow_mut()
            .insert(order.id.clone(), order.clone());
        Ok(())
    }
}
