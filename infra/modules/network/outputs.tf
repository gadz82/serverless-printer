output "vpc_id" {
  description = "ID of the created VPC, the looked-up VPC, or null when vpc_mode is none."
  value       = local.vpc_id
}

output "private_subnet_ids" {
  description = "Private subnets for the worker: the created private subnets or the looked-up subnet selection."
  value       = local.private_subnet_ids
}

output "public_subnet_ids" {
  description = "Created public subnets when enable_nat_gateway is true, otherwise empty."
  value       = local.public_subnet_ids
}

output "worker_security_group_id" {
  description = "First security group attached to the worker, or null when vpc_mode is none."
  value       = try(local.worker_security_group_ids[0], null)
}

output "worker_security_group_ids" {
  description = "Security groups attached to the worker: the managed group or the operator-supplied lookup groups."
  value       = local.worker_security_group_ids
}

output "nat_gateway_ids" {
  description = "NAT gateway IDs created when enable_nat_gateway is true."
  value       = aws_nat_gateway.this[*].id
}

output "s3_endpoint_id" {
  description = "S3 gateway endpoint ID in create mode, otherwise null."
  value       = try(aws_vpc_endpoint.s3[0].id, null)
}

output "interface_endpoint_ids" {
  description = "Interface endpoint IDs keyed by service: events, lambda and sqs."
  value       = { for name, endpoint in aws_vpc_endpoint.interface : name => endpoint.id }
}
