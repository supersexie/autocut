data "aws_availability_zones" "available" {
  filter {
    name   = "opt-in-status"
    values = ["opt-in-not-required"]
  }
}

locals {
  azs = slice(data.aws_availability_zones.available.names, 0, 3)
}

# Big private subnets (/18 each: ~16,000 addresses) because every pod gets its own VPC address and
# there can be tens of thousands of them.
module "vpc" {
  source  = "terraform-aws-modules/vpc/aws"
  version = "~> 5.16"

  name = var.name
  cidr = "10.0.0.0/16"
  azs  = local.azs

  private_subnets = ["10.0.0.0/18", "10.0.64.0/18", "10.0.128.0/18"]
  public_subnets  = ["10.0.192.0/22", "10.0.196.0/22", "10.0.200.0/22"]

  enable_nat_gateway     = true
  one_nat_gateway_per_az = true # one per zone, so a zone going down doesn't cut off the others

  public_subnet_tags = { "kubernetes.io/role/elb" = 1 }
  private_subnet_tags = {
    "kubernetes.io/role/internal-elb" = 1
    "karpenter.sh/discovery"          = var.name
  }
}

# Uploads and downloads to S3 (if used) skip the NAT.
resource "aws_vpc_endpoint" "s3" {
  vpc_id            = module.vpc.vpc_id
  service_name      = "com.amazonaws.${var.region}.s3"
  vpc_endpoint_type = "Gateway"
  route_table_ids   = module.vpc.private_route_table_ids
}
