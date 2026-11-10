data "aws_availability_zones" "available" {
  count = var.vpc_mode == "create" && length(var.availability_zones) == 0 ? 1 : 0

  state = "available"
}

locals {
  create_vpc  = var.vpc_mode == "create"
  lookup_vpc  = var.vpc_mode == "lookup"
  vpc_enabled = var.vpc_mode != "none"

  subnet_newbits = max(24 - try(tonumber(split("/", var.vpc_cidr)[1]), 16), 4)

  available_availability_zones = local.create_vpc ? (
    length(var.availability_zones) > 0
    ? var.availability_zones
    : data.aws_availability_zones.available[0].names
  ) : []

  availability_zones = local.create_vpc ? (
    slice(
      local.available_availability_zones,
      0,
      min(var.az_count, length(local.available_availability_zones)),
    )
  ) : []

  vpc_id = local.create_vpc ? aws_vpc.this[0].id : (
    local.lookup_vpc ? (var.vpc_id != null ? var.vpc_id : data.aws_vpc.lookup[0].id) : null
  )

  private_subnet_ids = local.create_vpc ? aws_subnet.private[*].id : (
    local.lookup_vpc ? (
      length(var.subnet_ids) > 0 ? var.subnet_ids : data.aws_subnets.lookup[0].ids
    ) : []
  )
  public_subnet_ids = local.create_vpc ? aws_subnet.public[*].id : []

  create_worker_security_group = local.vpc_enabled && length(var.worker_security_group_ids) == 0
  worker_security_group_ids = !local.vpc_enabled ? [] : (
    length(var.worker_security_group_ids) > 0 ? var.worker_security_group_ids : aws_security_group.worker[*].id
  )

  enabled_interface_endpoints = local.create_vpc ? {
    events = var.enable_events_endpoint
    lambda = var.enable_lambda_endpoint
    sqs    = var.enable_sqs_endpoint
  } : {}
  interface_endpoints = {
    for name, enabled in local.enabled_interface_endpoints : name => enabled if enabled
  }
}

resource "terraform_data" "availability_zone_guard" {
  count = local.create_vpc ? 1 : 0

  input = {
    az_count           = var.az_count
    availability_zones = local.available_availability_zones
  }

  lifecycle {
    precondition {
      condition     = length(local.available_availability_zones) >= var.az_count
      error_message = "az_count (${var.az_count}) exceeds the ${length(local.available_availability_zones)} availability zones available for vpc_mode = create. Set az_count to ${length(local.available_availability_zones)} or fewer, or provide at least ${var.az_count} distinct availability_zones."
    }
  }
}

data "aws_vpc" "lookup" {
  count = local.lookup_vpc && var.vpc_id == null ? 1 : 0

  dynamic "filter" {
    for_each = var.vpc_tags

    content {
      name   = "tag:${filter.key}"
      values = [filter.value]
    }
  }
}

data "aws_subnets" "lookup" {
  count = local.lookup_vpc && length(var.subnet_ids) == 0 ? 1 : 0

  filter {
    name   = "vpc-id"
    values = [local.vpc_id]
  }

  dynamic "filter" {
    for_each = var.subnet_tags

    content {
      name   = "tag:${filter.key}"
      values = [filter.value]
    }
  }
}

resource "aws_vpc" "this" {
  count = local.create_vpc ? 1 : 0

  cidr_block           = var.vpc_cidr
  enable_dns_support   = true
  enable_dns_hostnames = true

  tags = merge(var.tags, {
    Name = "${var.name_prefix}-vpc"
  })
}

resource "aws_subnet" "private" {
  count = local.create_vpc ? length(local.availability_zones) : 0

  vpc_id                  = aws_vpc.this[0].id
  cidr_block              = cidrsubnet(var.vpc_cidr, local.subnet_newbits, count.index)
  availability_zone       = local.availability_zones[count.index]
  map_public_ip_on_launch = false

  tags = merge(var.tags, {
    Name = "${var.name_prefix}-private-${count.index + 1}"
    Tier = "private"
  })
}

resource "aws_subnet" "public" {
  count = local.create_vpc && var.enable_nat_gateway ? length(local.availability_zones) : 0

  vpc_id                  = aws_vpc.this[0].id
  cidr_block              = cidrsubnet(var.vpc_cidr, local.subnet_newbits, var.az_count + count.index)
  availability_zone       = local.availability_zones[count.index]
  map_public_ip_on_launch = false

  tags = merge(var.tags, {
    Name = "${var.name_prefix}-public-${count.index + 1}"
    Tier = "public"
  })
}

resource "aws_internet_gateway" "this" {
  count = local.create_vpc && var.enable_nat_gateway ? 1 : 0

  vpc_id = aws_vpc.this[0].id

  tags = merge(var.tags, {
    Name = "${var.name_prefix}-igw"
  })
}

resource "aws_route_table" "private" {
  count = local.create_vpc ? 1 : 0

  vpc_id = aws_vpc.this[0].id

  tags = merge(var.tags, {
    Name = "${var.name_prefix}-private"
  })
}

resource "aws_route_table_association" "private" {
  count = local.create_vpc ? length(local.availability_zones) : 0

  subnet_id      = aws_subnet.private[count.index].id
  route_table_id = aws_route_table.private[0].id
}

resource "aws_route_table" "public" {
  count = local.create_vpc && var.enable_nat_gateway ? 1 : 0

  vpc_id = aws_vpc.this[0].id

  tags = merge(var.tags, {
    Name = "${var.name_prefix}-public"
  })
}

resource "aws_route_table_association" "public" {
  count = local.create_vpc && var.enable_nat_gateway ? length(local.availability_zones) : 0

  subnet_id      = aws_subnet.public[count.index].id
  route_table_id = aws_route_table.public[0].id
}

resource "aws_route" "public_internet" {
  count = local.create_vpc && var.enable_nat_gateway ? 1 : 0

  route_table_id         = aws_route_table.public[0].id
  destination_cidr_block = "0.0.0.0/0"
  gateway_id             = aws_internet_gateway.this[0].id
}

resource "aws_eip" "nat" {
  count = local.create_vpc && var.enable_nat_gateway ? 1 : 0

  domain = "vpc"

  tags = merge(var.tags, {
    Name = "${var.name_prefix}-nat"
  })
}

resource "aws_nat_gateway" "this" {
  count = local.create_vpc && var.enable_nat_gateway ? 1 : 0

  allocation_id = aws_eip.nat[0].id
  subnet_id     = aws_subnet.public[0].id

  tags = merge(var.tags, {
    Name = "${var.name_prefix}-nat"
  })

  depends_on = [
    aws_route.public_internet,
    aws_route_table_association.public,
  ]
}

resource "aws_route" "private_nat" {
  count = local.create_vpc && var.enable_nat_gateway ? 1 : 0

  route_table_id         = aws_route_table.private[0].id
  destination_cidr_block = "0.0.0.0/0"
  nat_gateway_id         = aws_nat_gateway.this[0].id
}

resource "aws_vpc_endpoint" "s3" {
  count = local.create_vpc && var.enable_s3_endpoint ? 1 : 0

  vpc_id            = aws_vpc.this[0].id
  service_name      = "com.amazonaws.${var.region}.s3"
  vpc_endpoint_type = "Gateway"
  route_table_ids   = [aws_route_table.private[0].id]

  tags = merge(var.tags, {
    Name = "${var.name_prefix}-s3"
  })
}

resource "aws_security_group" "worker" {
  count = local.create_worker_security_group ? 1 : 0

  name_prefix = "${var.name_prefix}-worker-"
  description = "Render worker egress for DNS, HTTPS and VPC service endpoints"
  vpc_id      = local.vpc_id

  tags = merge(var.tags, {
    Name = "${var.name_prefix}-worker"
  })
}

resource "aws_vpc_security_group_egress_rule" "worker_dns_udp" {
  count = local.create_worker_security_group ? 1 : 0

  security_group_id = aws_security_group.worker[0].id
  description       = "DNS over UDP"
  cidr_ipv4         = "0.0.0.0/0"
  ip_protocol       = "udp"
  from_port         = 53
  to_port           = 53
}

resource "aws_vpc_security_group_egress_rule" "worker_dns_tcp" {
  count = local.create_worker_security_group ? 1 : 0

  security_group_id = aws_security_group.worker[0].id
  description       = "DNS over TCP"
  cidr_ipv4         = "0.0.0.0/0"
  ip_protocol       = "tcp"
  from_port         = 53
  to_port           = 53
}

resource "aws_vpc_security_group_egress_rule" "worker_https" {
  count = local.create_worker_security_group ? 1 : 0

  security_group_id = aws_security_group.worker[0].id
  description       = "HTTPS to VPC endpoints and callback hosts"
  cidr_ipv4         = "0.0.0.0/0"
  ip_protocol       = "tcp"
  from_port         = 443
  to_port           = 443
}

resource "aws_security_group" "endpoints" {
  count = length(local.interface_endpoints) > 0 ? 1 : 0

  name_prefix = "${var.name_prefix}-endpoints-"
  description = "Allow the render worker to reach interface VPC endpoints"
  vpc_id      = local.vpc_id

  tags = merge(var.tags, {
    Name = "${var.name_prefix}-endpoints"
  })
}

resource "aws_vpc_security_group_ingress_rule" "endpoints_https" {
  count = length(local.interface_endpoints) > 0 ? 1 : 0

  security_group_id            = aws_security_group.endpoints[0].id
  referenced_security_group_id = local.worker_security_group_ids[0]
  description                  = "HTTPS from the render worker"
  ip_protocol                  = "tcp"
  from_port                    = 443
  to_port                      = 443
}

resource "aws_vpc_endpoint" "interface" {
  for_each = local.interface_endpoints

  vpc_id              = aws_vpc.this[0].id
  service_name        = "com.amazonaws.${var.region}.${each.key}"
  vpc_endpoint_type   = "Interface"
  subnet_ids          = aws_subnet.private[*].id
  security_group_ids  = [aws_security_group.endpoints[0].id]
  private_dns_enabled = true

  tags = merge(var.tags, {
    Name = "${var.name_prefix}-${each.key}"
  })
}
