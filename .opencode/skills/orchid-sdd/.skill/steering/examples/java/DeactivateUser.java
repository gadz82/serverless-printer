// Placement (illustrative):
//   src/domain/User.java                       -> User
//   src/ports/UserRepository.java              -> UserRepository
//   src/application/DeactivateUser.java        -> DeactivateUser

import java.util.Optional;

public record User(String id, String email, boolean active) {
}

interface UserRepository {
    Optional<User> findById(String id);

    void save(User user);
}

public final class DeactivateUser {
    private final UserRepository users;

    public DeactivateUser(UserRepository users) {
        this.users = users;
    }

    public User execute(String id) {
        User user = users.findById(id)
            .orElseThrow(() -> new IllegalArgumentException("user not found"));
        if (!user.active()) {
            return user;
        }

        User deactivated = new User(user.id(), user.email(), false);
        users.save(deactivated);
        return deactivated;
    }
}
