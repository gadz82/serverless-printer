terraform {
  # The bucket and region come from the bootstrap outputs at init time:
  #   terraform init -backend-config="bucket=<state_bucket>" \
  #     -backend-config="region=<region>"
  backend "s3" {
    key          = "printer/terraform.tfstate"
    use_lockfile = true
    encrypt      = true
  }
}
