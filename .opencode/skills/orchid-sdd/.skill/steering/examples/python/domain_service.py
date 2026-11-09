# Placement (illustrative):
#   src/domain/user.py                         -> User
#   src/ports/user_repository.py               -> UserRepository
#   src/application/deactivate_user.py         -> DeactivateUser

from dataclasses import dataclass, replace
from typing import Protocol


@dataclass(frozen=True)
class User:
    id: str
    email: str
    active: bool


class UserRepository(Protocol):
    def find_by_id(self, user_id: str) -> User | None: ...

    def save(self, user: User) -> None: ...


class DeactivateUser:
    """Application behaviour using an explicit port."""

    def __init__(self, users: UserRepository) -> None:
        self._users = users

    def execute(self, user_id: str) -> User:
        user = self._users.find_by_id(user_id)
        if user is None:
            raise LookupError("user not found")
        if not user.active:
            return user

        deactivated = replace(user, active=False)
        self._users.save(deactivated)
        return deactivated
