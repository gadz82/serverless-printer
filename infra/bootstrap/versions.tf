terraform {
  required_version = ">= 1.11.0"

  # This root module creates the state bucket, so its own state stays local.
  backend "local" {}

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.0"
    }

    tls = {
      source  = "hashicorp/tls"
      version = "~> 4.0"
    }
  }
}
