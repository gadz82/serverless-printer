// Placement (illustrative):
//   internal/domain/user.go                    -> User
//   internal/ports/user_repository.go          -> UserRepository
//   internal/application/deactivate_user.go    -> DeactivateUser

package domain

import (
	"context"
	"errors"
)

type User struct {
	ID     string
	Email  string
	Active bool
}

var ErrUserNotFound = errors.New("user not found")

// UserRepository is owned by the application/domain boundary.
type UserRepository interface {
	FindByID(ctx context.Context, id string) (*User, error)
	Save(ctx context.Context, user User) error
}

type DeactivateUser struct {
	users UserRepository
}

func NewDeactivateUser(users UserRepository) *DeactivateUser {
	return &DeactivateUser{users: users}
}

func (s *DeactivateUser) Execute(ctx context.Context, id string) (User, error) {
	user, err := s.users.FindByID(ctx, id)
	if err != nil {
		return User{}, err
	}
	if user == nil {
		return User{}, ErrUserNotFound
	}
	if !user.Active {
		return *user, nil
	}

	updated := *user
	updated.Active = false
	if err := s.users.Save(ctx, updated); err != nil {
		return User{}, err
	}
	return updated, nil
}
