// Placement (illustrative):
//   src/domain/user.rs                         -> User
//   src/ports/user_repository.rs               -> UserRepository
//   src/application/deactivate_user.rs         -> DeactivateUser

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct User {
    pub id: String,
    pub email: String,
    pub active: bool,
}

#[derive(Debug, PartialEq, Eq)]
pub enum DomainError {
    UserNotFound,
    Repository(String),
}

pub trait UserRepository {
    fn find_by_id(&self, id: &str) -> Result<Option<User>, DomainError>;
    fn save(&self, user: &User) -> Result<(), DomainError>;
}

pub struct DeactivateUser<R: UserRepository> {
    users: R,
}

impl<R: UserRepository> DeactivateUser<R> {
    pub fn new(users: R) -> Self {
        Self { users }
    }

    pub fn execute(&self, id: &str) -> Result<User, DomainError> {
        let user = self.users.find_by_id(id)?.ok_or(DomainError::UserNotFound)?;
        if !user.active {
            return Ok(user);
        }

        let deactivated = User {
            active: false,
            ..user
        };
        self.users.save(&deactivated)?;
        Ok(deactivated)
    }
}
