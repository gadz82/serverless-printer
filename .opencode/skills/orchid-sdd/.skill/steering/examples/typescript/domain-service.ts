// Placement (illustrative):
//   src/domain/user.ts                         -> User
//   src/ports/user-repository.ts               -> UserRepository
//   src/application/deactivate-user.ts         -> DeactivateUser

import type { User, UserRepository } from "./hexagonal-port";

/**
 * Application behavior using an explicit port.
 * It knows the contract, not the database or HTTP framework.
 */
export class DeactivateUser {
  constructor(private readonly users: UserRepository) {}

  async execute(id: string): Promise<User> {
    const user = await this.users.findById(id);
    if (!user) throw new Error("user not found");
    if (!user.active) return user;

    const deactivated = { ...user, active: false };
    await this.users.save(deactivated);
    return deactivated;
  }
}
