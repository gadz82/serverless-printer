// Placement (illustrative):
//   src/domain/events/order_placed.rs          -> OrderPlaced
//   src/application/order_event_publisher.rs   -> OrderEventPublisher
//   src/application/order_projection_consumer.rs -> OrderProjectionConsumer
//   src/ports/event_publisher.rs               -> EventPublisher
//   src/ports/processed_event_store.rs         -> ProcessedEventStore

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct OrderPlaced {
    pub event_id: String,
    pub order_id: String,
    pub total: i64,
    pub version: u8,
}

#[derive(Debug)]
pub enum EventError {
    InvalidTotal,
    Publish(String),
    Projection(String),
    Store(String),
}

pub trait EventPublisher {
    fn publish(&self, event: &OrderPlaced) -> Result<(), EventError>;
}

pub trait ProcessedEventStore {
    fn has(&self, event_id: &str) -> Result<bool, EventError>;
    fn mark(&self, event_id: &str) -> Result<(), EventError>;
}

#[derive(Debug, PartialEq, Eq)]
pub enum HandleOutcome {
    Processed,
    Duplicate,
}

pub struct OrderEventPublisher<P: EventPublisher> {
    publisher: P,
}

impl<P: EventPublisher> OrderEventPublisher<P> {
    pub fn new(publisher: P) -> Self {
        Self { publisher }
    }

    pub fn publish(&self, event_id: &str, order_id: &str, total: i64) -> Result<(), EventError> {
        if total <= 0 {
            return Err(EventError::InvalidTotal);
        }
        self.publisher.publish(&OrderPlaced {
            event_id: event_id.to_string(),
            order_id: order_id.to_string(),
            total,
            version: 1,
        })
    }
}

pub struct OrderProjectionConsumer<S, F>
where
    S: ProcessedEventStore,
    F: Fn(&OrderPlaced) -> Result<(), EventError>,
{
    processed: S,
    project: F,
}

impl<S, F> OrderProjectionConsumer<S, F>
where
    S: ProcessedEventStore,
    F: Fn(&OrderPlaced) -> Result<(), EventError>,
{
    pub fn new(processed: S, project: F) -> Self {
        Self { processed, project }
    }

    pub fn handle(&self, event: &OrderPlaced) -> Result<HandleOutcome, EventError> {
        if self.processed.has(&event.event_id)? {
            return Ok(HandleOutcome::Duplicate);
        }
        (self.project)(event)?;
        self.processed.mark(&event.event_id)?;
        Ok(HandleOutcome::Processed)
    }
}
