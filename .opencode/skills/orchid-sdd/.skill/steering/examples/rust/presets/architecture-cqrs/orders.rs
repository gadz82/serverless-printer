// Placement (illustrative):
//   src/domain/order_line.rs                   -> OrderLine
//   src/application/commands/place_order.rs    -> PlaceOrder, PlaceOrderHandler
//   src/application/queries/order_summary.rs   -> OrderSummary, OrderSummaryReader, GetOrderSummary

#[derive(Debug, Clone)]
pub struct OrderLine {
    pub sku: String,
    pub quantity: u32,
    pub unit_price: i64,
}

#[derive(Debug, Clone)]
pub struct PlaceOrder {
    pub order_id: String,
    pub lines: Vec<OrderLine>,
}

#[derive(Debug, Clone)]
pub struct OrderSummary {
    pub order_id: String,
    pub line_count: usize,
    pub total: i64,
}

#[derive(Debug)]
pub enum OrdersError {
    EmptyOrder,
    NotFound,
    Backend(String),
}

pub trait OrderWriter {
    fn save(&self, command: &PlaceOrder) -> Result<(), OrdersError>;
}

pub trait OrderSummaryReader {
    fn by_id(&self, order_id: &str) -> Result<Option<OrderSummary>, OrdersError>;
}

pub struct PlaceOrderHandler<W: OrderWriter> {
    writer: W,
}

impl<W: OrderWriter> PlaceOrderHandler<W> {
    pub fn new(writer: W) -> Self {
        Self { writer }
    }

    pub fn execute(&self, command: &PlaceOrder) -> Result<(), OrdersError> {
        if command.lines.is_empty() {
            return Err(OrdersError::EmptyOrder);
        }
        self.writer.save(command)
    }
}

pub struct GetOrderSummary<R: OrderSummaryReader> {
    reader: R,
}

impl<R: OrderSummaryReader> GetOrderSummary<R> {
    pub fn new(reader: R) -> Self {
        Self { reader }
    }

    pub fn execute(&self, order_id: &str) -> Result<OrderSummary, OrdersError> {
        self.reader
            .by_id(order_id)?
            .ok_or(OrdersError::NotFound)
    }
}
