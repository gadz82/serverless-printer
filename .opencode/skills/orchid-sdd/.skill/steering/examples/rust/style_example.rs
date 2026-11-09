// Placement (illustrative):
//   src/payments/payment_request.rs            -> PaymentRequest
//   src/payments/payment_gateway.rs            -> PaymentGateway
//   src/payments/payment_service.rs            -> PaymentService

use std::fmt;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct PaymentRequest<'a> {
    pub order_id: &'a str,
    pub amount: u64,
}

#[derive(Debug)]
pub enum PaymentError {
    InvalidRequest(&'static str),
    Provider(String),
}

impl fmt::Display for PaymentError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::InvalidRequest(message) => write!(f, "{message}"),
            Self::Provider(message) => write!(f, "provider error: {message}"),
        }
    }
}

pub trait PaymentGateway {
    fn charge(&self, request: PaymentRequest<'_>) -> Result<(), PaymentError>;
}

pub struct PaymentService<G: PaymentGateway> {
    gateway: G,
}

impl<G: PaymentGateway> PaymentService<G> {
    pub fn new(gateway: G) -> Self {
        Self { gateway }
    }

    pub fn charge(&self, order_id: &str, amount: u64) -> Result<(), PaymentError> {
        if order_id.is_empty() {
            return Err(PaymentError::InvalidRequest("order_id is required"));
        }
        if amount == 0 {
            return Err(PaymentError::InvalidRequest("amount must be positive"));
        }
        // The provider timeout is intentional: a retry must use the same idempotency key.
        self.gateway.charge(PaymentRequest { order_id, amount })
    }
}
