// Placement (illustrative):
//   src/domain/user.ts                         -> User
//   src/ports/user-repository.ts               -> UserRepository
//   src/adapters/in-memory-user-repository.ts  -> InMemoryUserRepository

/**
 * An example port and its in-memory adapter.
 *
 * The domain owns the port. The adapter owns I/O and may be replaced in tests.
 */
export type User = {
  id: string;
  email: string;
  active: boolean;
};

export interface UserRepository {
  findById(id: string): Promise<User | null>;
  save(user: User): Promise<void>;
}

export class InMemoryUserRepository implements UserRepository {
  private readonly users = new Map<string, User>();

  async findById(id: string): Promise<User | null> {
    return this.users.get(id) ?? null;
  }

  async save(user: User): Promise<void> {
    this.users.set(user.id, user);
  }
}
