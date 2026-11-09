# frozen_string_literal: true

# Placement (illustrative):
#   lib/domain/user.rb                         -> User
#   lib/ports/user_repository.rb               -> UserRepository
#   lib/application/deactivate_user.rb         -> DeactivateUser

User = Data.define(:id, :email, :active)

class DeactivateUser
  def initialize(users)
    @users = users
  end

  def execute(id)
    user = @users.find_by_id(id)
    raise ArgumentError, "user not found" unless user
    return user unless user.active

    deactivated = user.with(active: false)
    @users.save(deactivated)
    deactivated
  end
end
