<?php

// Placement (illustrative):
//   src/domain/User.php                        -> User
//   src/ports/UserRepository.php               -> UserRepository
//   src/application/DeactivateUser.php         -> DeactivateUser, DomainException

declare(strict_types=1);

final class DomainException extends RuntimeException
{
}

final readonly class User
{
    public function __construct(
        public string $id,
        public string $email,
        public bool $active,
    ) {
    }
}

interface UserRepository
{
    public function findById(string $id): ?User;

    public function save(User $user): void;
}

final class DeactivateUser
{
    public function __construct(private UserRepository $users)
    {
    }

    public function execute(string $id): User
    {
        $user = $this->users->findById($id);
        if ($user === null) {
            throw new DomainException('user not found');
        }
        if (!$user->active) {
            return $user;
        }

        $deactivated = new User($user->id, $user->email, false);
        $this->users->save($deactivated);
        return $deactivated;
    }
}
